import {
  WorkflowDefinition,
  WorkflowExecutionContext,
  ExecutionStatus,
  NodeType,
  NodeExecutionInput,
  DBWorkflow,
  DBWorkflowNode,
  DBWorkflowEdge,
  DBWorkflowExecution,
  DBNodeExecution,
  TriggerType,
} from '../../types';
import { nodeProcessorFactory } from './processors/NodeProcessorFactory';
import { logger } from '../../utils/logger';
import { pool } from '../../config/database';
import { executionEventEmitter } from '../ExecutionEventEmitter';
import { WORKFLOW_CONSTANTS } from '../../config/constants';
import { invalidateExecutionTokens } from '../subscription-token.service';

/**
 * Workflow Execution Engine
 * Orchestrates the execution of workflows, managing node-by-node execution
 */
export class WorkflowExecutionEngine {
  /**
   * Execute a complete workflow
   */
  async executeWorkflow(
    workflowId: string,
    userId: string,
    triggeredBy: TriggerType,
    initialInput?: Record<string, any>,
    providedExecutionId?: string
  ): Promise<WorkflowExecutionContext> {
    logger.info({ workflowId, userId, triggeredBy }, 'Starting workflow execution');

    // Create execution context
    const executionId = await this.createWorkflowExecution(
      workflowId,
      userId,
      triggeredBy,
      initialInput,
      providedExecutionId
    );

    const context: WorkflowExecutionContext = {
      executionId,
      workflowId,
      userId,
      triggeredBy,
      triggeredAt: new Date(),
      initialInput,
      nodeOutputs: new Map(),
      status: ExecutionStatus.RUNNING,
      startedAt: new Date(),
      retryCount: 0,
    };

    try {
      // Update execution status
      await this.updateExecutionStatus(executionId, ExecutionStatus.RUNNING);

      // Load workflow definition
      const workflow = await this.loadWorkflow(workflowId);

      // Emit execution started event
      executionEventEmitter.emitExecutionEvent({
        type: 'execution:started',
        executionId,
        workflowId,
        status: ExecutionStatus.RUNNING,
        timestamp: new Date(),
      });

      // Execute workflow with branching support
      await this.executeWorkflowWithBranching(workflow, context);

      // If no errors, mark as success
      if (context.status === ExecutionStatus.RUNNING) {
        context.status = ExecutionStatus.SUCCESS;
        context.completedAt = new Date();
      }

      // Update execution status
      await this.updateExecutionStatus(
        executionId,
        context.status,
        context.error
      );

      // Update workflow last executed timestamp
      await this.updateWorkflowLastExecuted(workflowId);

      // Collect oracle results for summary
      const oracleResults: string[] = [];
      context.nodeOutputs.forEach((output: any) => {
        if (output && (output.provider === 'CHAINLINK' || output.provider === 'PYTH')) {
          if (output.provider === 'CHAINLINK') {
            oracleResults.push(`${output.description || 'Price'}: $${output.formattedAnswer}`);
          } else {
            oracleResults.push(`Price: $${output.formattedPrice}`);
          }
        }
      });

      const duration = context.completedAt
        ? context.completedAt.getTime() - context.startedAt.getTime()
        : null;

      logger.info(
        {
          executionId,
          status: context.status,
          duration,
          nodesExecuted: context.nodeOutputs.size,
          ...(oracleResults.length > 0 && { oraclePrices: oracleResults }),
        },
        context.status === ExecutionStatus.SUCCESS
          ? `✅ Workflow execution completed successfully in ${duration}ms${oracleResults.length > 0 ? ' | ' + oracleResults.join(' | ') : ''}`
          : 'Workflow execution completed'
      );

      // Emit execution completed event
      executionEventEmitter.emitExecutionEvent({
        type: 'execution:completed',
        executionId,
        workflowId,
        status: context.status,
        timestamp: new Date(),
      });

      // Invalidate subscription tokens for this execution
      await invalidateExecutionTokens(executionId);

      return context;
    } catch (error) {
      logger.error({ error, executionId }, 'Workflow execution failed');

      context.status = ExecutionStatus.FAILED;
      context.error = {
        message: (error as Error).message,
        code: 'WORKFLOW_EXECUTION_ERROR',
      };
      context.completedAt = new Date();

      await this.updateExecutionStatus(
        executionId,
        ExecutionStatus.FAILED,
        context.error
      );

      // Emit execution failed event
      executionEventEmitter.emitExecutionEvent({
        type: 'execution:failed',
        executionId,
        workflowId,
        status: ExecutionStatus.FAILED,
        error: context.error,
        timestamp: new Date(),
      });

      // Invalidate subscription tokens for this execution
      await invalidateExecutionTokens(executionId);

      return context;
    }
  }

  /**
   * Load workflow definition from database
   */
  private async loadWorkflow(workflowId: string): Promise<WorkflowDefinition> {
    // Load workflow
    const workflowResult = await pool.query<DBWorkflow>(
      'SELECT * FROM workflows WHERE id = $1',
      [workflowId]
    );

    if (workflowResult.rows.length === 0) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const workflow = workflowResult.rows[0];

    // Load nodes
    const nodesResult = await pool.query<DBWorkflowNode>(
      'SELECT * FROM workflow_nodes WHERE workflow_id = $1',
      [workflowId]
    );

    // Load edges
    const edgesResult = await pool.query<DBWorkflowEdge>(
      'SELECT * FROM workflow_edges WHERE workflow_id = $1',
      [workflowId]
    );

    return {
      id: workflow.id,
      userId: workflow.user_id,
      name: workflow.name,
      description: workflow.description,
      version: workflow.version,
      nodes: nodesResult.rows.map(n => ({
        id: n.id,
        type: n.type,
        name: n.name,
        description: n.description,
        config: n.config,
        position: n.position,
        metadata: n.metadata,
      })),
      edges: edgesResult.rows.map(e => ({
        id: e.id,
        sourceNodeId: e.source_node_id,
        targetNodeId: e.target_node_id,
        sourceHandle: e.source_handle || undefined,
        targetHandle: e.target_handle || undefined,
        condition: e.condition,
        dataMapping: e.data_mapping,
      })),
      triggerNodeId: workflow.trigger_node_id,
      isActive: workflow.is_active,
      isDraft: workflow.is_draft,
      createdAt: workflow.created_at,
      updatedAt: workflow.updated_at,
      lastExecutedAt: workflow.last_executed_at,
      maxConcurrentExecutions: workflow.max_concurrent_executions,
      timeout: workflow.timeout,
      tags: workflow.tags,
      category: workflow.category,
    };
  }

  /**
   * Execute workflow with branching support (handles IF nodes)
   */
  private async executeWorkflowWithBranching(
    workflow: WorkflowDefinition,
    context: WorkflowExecutionContext
  ): Promise<void> {
    const visited = new Set<string>();
    const branchDecisions = new Map<string, string>();
    const maxSteps = WORKFLOW_CONSTANTS.MAX_STEPS_PER_EXECUTION;
    let stepCount = 0;

    // Start from trigger node
    let currentNodeId: string | null = workflow.triggerNodeId;

    while (currentNodeId && stepCount < maxSteps) {
      stepCount++;

      // Prevent infinite loops
      if (visited.has(currentNodeId)) {
        logger.warn({ nodeId: currentNodeId }, 'Node already visited, breaking loop');
        break;
      }

      visited.add(currentNodeId);

      const node = workflow.nodes.find(n => n.id === currentNodeId);
      if (!node) {
        logger.error({ nodeId: currentNodeId }, 'Node not found');
        break;
      }

      // Skip TRIGGER nodes
      if (node.type === NodeType.TRIGGER) {
        logger.debug({ nodeId: currentNodeId }, 'Skipping trigger node');

        // Move to next node
        const nextEdges = workflow.edges.filter(e => e.sourceNodeId === currentNodeId);
        currentNodeId = nextEdges.length > 0 ? nextEdges[0].targetNodeId : null;
        continue;
      }

      logger.debug({ nodeId: currentNodeId, type: node.type }, 'Executing node');

      // Get input data from previous nodes
      const inputData = this.collectInputData(node.id, workflow, context);

      // Create node execution record
      const nodeExecutionId = await this.createNodeExecution(
        context.executionId,
        node.id,
        node.type,
        inputData
      );

      // Execute the node
      const nodeInput: NodeExecutionInput = {
        nodeId: node.id,
        nodeType: node.type,
        nodeConfig: node.config,
        inputData,
        executionContext: context,
        secrets: await this.loadUserSecrets(context.userId),
      };

      const processor = nodeProcessorFactory.getProcessor(node.type);

      // Emit node started event
      executionEventEmitter.emitExecutionEvent({
        type: 'node:started',
        executionId: context.executionId,
        workflowId: context.workflowId,
        nodeId: node.id,
        nodeType: node.type,
        status: ExecutionStatus.RUNNING,
        timestamp: new Date(),
      });

      const result = await processor.execute(nodeInput);

      // Update node execution record
      await this.updateNodeExecution(nodeExecutionId, result);

      // Store output in context
      context.nodeOutputs.set(node.id, result.output);
      context.currentNodeId = node.id;

      // Emit node completed/failed event
      executionEventEmitter.emitExecutionEvent({
        type: result.success ? 'node:completed' : 'node:failed',
        executionId: context.executionId,
        workflowId: context.workflowId,
        nodeId: node.id,
        nodeType: node.type,
        status: result.success ? ExecutionStatus.SUCCESS : ExecutionStatus.FAILED,
        output: result.output,
        error: result.error,
        timestamp: new Date(),
      });

      // Handle IF nodes - store branch decision
      if (node.type === NodeType.IF && result.output?.branchToFollow) {
        branchDecisions.set(node.id, result.output.branchToFollow);

        logger.info(
          {
            nodeId: node.id,
            branchChosen: result.output.branchToFollow,
          },
          'IF node: branch selected'
        );
      }

      // Check if node failed
      if (!result.success) {
        logger.error({ nodeId: node.id, error: result.error }, 'Node execution failed');

        if (!(node.config as any).continueOnError) {
          context.status = ExecutionStatus.FAILED;
          context.error = result.error;
          throw new Error(`Node ${node.id} failed: ${result.error?.message}`);
        }
      }

      // Get next node based on branching
      currentNodeId = this.getNextNode(node.id, branchDecisions, workflow);
    }

    if (stepCount >= maxSteps) {
      throw new Error(`Workflow exceeded maximum steps (${maxSteps})`);
    }
  }

  /**
   * Get next node to execute (handles IF node branching)
   */
  private getNextNode(
    currentNodeId: string,
    branchDecisions: Map<string, string>,
    workflow: WorkflowDefinition
  ): string | null {
    const currentNode = workflow.nodes.find(n => n.id === currentNodeId);

    // If this is an IF node, follow the chosen branch
    if (currentNode?.type === NodeType.IF) {
      const chosenBranch = branchDecisions.get(currentNodeId);

      if (chosenBranch) {
        // Find edge with matching sourceHandle
        const branchEdges = workflow.edges.filter(
          e => e.sourceNodeId === currentNodeId && e.sourceHandle === chosenBranch
        );

        if (branchEdges.length > 0) {
          return branchEdges[0].targetNodeId;
        }

        logger.warn(
          { nodeId: currentNodeId, branch: chosenBranch },
          'IF node: no edge found for chosen branch'
        );
        return null;
      }
    }

    // For regular nodes, follow the first outgoing edge
    const outgoingEdges = workflow.edges.filter(e => e.sourceNodeId === currentNodeId);

    if (outgoingEdges.length > 0) {
      return outgoingEdges[0].targetNodeId;
    }

    return null;
  }

  /**
   * Collect input data for a node from its predecessors
   */
  private collectInputData(
    nodeId: string,
    workflow: WorkflowDefinition,
    context: WorkflowExecutionContext
  ): any {
    // Get incoming edges
    const incomingEdges = workflow.edges.filter(e => e.targetNodeId === nodeId);

    if (incomingEdges.length === 0) {
      // Trigger node - use initial input
      return context.initialInput || {};
    }

    // Collect outputs from predecessor nodes (existing behavior)
    const inputData: any = {};

    for (const edge of incomingEdges) {
      const sourceOutput = context.nodeOutputs.get(edge.sourceNodeId);

      if (edge.dataMapping) {
        // Apply data mapping
        for (const [targetKey, sourcePath] of Object.entries(edge.dataMapping)) {
          inputData[targetKey] = this.getValueByPath(sourceOutput, sourcePath);
        }
      } else {
        // Direct pass-through
        Object.assign(inputData, sourceOutput);
      }
    }

    // NEW: Add blocks namespace with all upstream ancestors
    // This allows any node to reference any upstream node's output via {{blocks.<nodeId>}}
    const upstreamAncestors = this.getAllUpstreamNodes(nodeId, workflow);
    inputData.blocks = {};

    for (const ancestorNodeId of upstreamAncestors) {
      const ancestorOutput = context.nodeOutputs.get(ancestorNodeId);
      if (ancestorOutput) {
        inputData.blocks[ancestorNodeId] = ancestorOutput;
      }
    }

    // Debug: Log what data we're passing to this node
    logger.info(
      {
        targetNodeId: nodeId,
        upstreamAncestorIds: upstreamAncestors,
        blocksPopulated: Object.keys(inputData.blocks),
        directInputKeys: Object.keys(inputData).filter(k => k !== 'blocks'),
      },
      'Collected input data for node (debug)'
    );

    return inputData;
  }

  /**
   * Get all upstream ancestor nodes (transitive predecessors) for a given node
   * Uses BFS to traverse backwards through the workflow graph
   */
  private getAllUpstreamNodes(
    nodeId: string,
    workflow: WorkflowDefinition
  ): string[] {
    const visited = new Set<string>();
    const queue: string[] = [nodeId];
    const ancestors: string[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      if (visited.has(currentId)) {
        continue;
      }

      visited.add(currentId);

      // Find all nodes that point to the current node
      const incomingEdges = workflow.edges.filter(e => e.targetNodeId === currentId);

      for (const edge of incomingEdges) {
        const sourceNodeId = edge.sourceNodeId;

        // Don't include the starting node itself
        if (sourceNodeId !== nodeId && !visited.has(sourceNodeId)) {
          ancestors.push(sourceNodeId);
          queue.push(sourceNodeId);
        }
      }
    }

    return ancestors;
  }

  /**
   * Get value from object by path
   */
  private getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Load user secrets (encrypted wallet keys, API keys, etc.)
   */
  private async loadUserSecrets(_userId: string): Promise<Record<string, string>> {
    // TODO: Implement secure secret management
    // This should load encrypted secrets from a secure store (e.g., AWS KMS, HashiCorp Vault)
    // and decrypt them for use in execution

    // For now, load from environment variables
    // In production, this would load and decrypt from secure storage:
    // - Wallet private keys
    // - API keys for providers
    // - Other sensitive credentials

    const secrets: Record<string, string> = {};

    // Load wallet private key from environment
    if (process.env.WALLET_PRIVATE_KEY) {
      secrets.WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
    }

    return secrets;
  }

  /**
   * Create workflow execution record
   */
  private async createWorkflowExecution(
    workflowId: string,
    userId: string,
    triggeredBy: TriggerType,
    initialInput?: Record<string, any>,
    providedExecutionId?: string
  ): Promise<string> {
    // Get current workflow version
    const workflowResult = await pool.query<{ version: number }>(
      'SELECT version FROM workflows WHERE id = $1',
      [workflowId]
    );
    const versionNumber = workflowResult.rows[0]?.version || 1;

    // If execution ID is provided, use it; otherwise let the database generate one
    if (providedExecutionId) {
      // Check if execution already exists (e.g., from a retry)
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM workflow_executions WHERE id = $1`,
        [providedExecutionId]
      );

      if (existing.rows.length > 0) {
        logger.info(
          { executionId: providedExecutionId },
          'Workflow execution already exists, reusing existing execution'
        );
        return existing.rows[0].id;
      }

      // Insert new execution with provided ID and version_number
      const result = await pool.query<{ id: string }>(
        `INSERT INTO workflow_executions (
          id,
          workflow_id,
          user_id,
          triggered_by,
          initial_input,
          status,
          version_number
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
        RETURNING id`,
        [
          providedExecutionId,
          workflowId,
          userId,
          triggeredBy,
          initialInput ? JSON.stringify(initialInput) : null,
          ExecutionStatus.PENDING,
          versionNumber,
        ]
      );

      // If insert was skipped due to conflict, fetch the existing one
      if (result.rows.length === 0) {
        const existingAfterConflict = await pool.query<{ id: string }>(
          `SELECT id FROM workflow_executions WHERE id = $1`,
          [providedExecutionId]
        );
        if (existingAfterConflict.rows.length > 0) {
          logger.info(
            { executionId: providedExecutionId },
            'Workflow execution created by concurrent request, reusing existing execution'
          );
          return existingAfterConflict.rows[0].id;
        }
      }

      return result.rows[0].id;
    } else {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO workflow_executions (
          workflow_id,
          user_id,
          triggered_by,
          initial_input,
          status,
          version_number
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id`,
        [
          workflowId,
          userId,
          triggeredBy,
          initialInput ? JSON.stringify(initialInput) : null,
          ExecutionStatus.PENDING,
          versionNumber,
        ]
      );
      return result.rows[0].id;
    }
  }

  /**
   * Update execution status
   */
  private async updateExecutionStatus(
    executionId: string,
    status: ExecutionStatus,
    error?: any
  ): Promise<void> {
    // Custom JSON replacer to handle BigInt values
    const jsonReplacer = (_key: string, value: any) => {
      return typeof value === 'bigint' ? value.toString() : value;
    };

    const fields = ['status = $1'];
    const values: any[] = [status];
    let paramIndex = 2;

    if (error) {
      fields.push(`error = $${paramIndex}`);
      values.push(JSON.stringify(error, jsonReplacer));
      paramIndex++;
    }

    if (status === ExecutionStatus.SUCCESS || status === ExecutionStatus.FAILED) {
      fields.push(`completed_at = NOW()`);
    }

    values.push(executionId);

    await pool.query(
      `UPDATE workflow_executions SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  /**
   * Create node execution record
   */
  private async createNodeExecution(
    executionId: string,
    nodeId: string,
    nodeType: NodeType,
    inputData: any
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO node_executions (
        execution_id,
        node_id,
        node_type,
        input_data,
        status
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id`,
      [
        executionId,
        nodeId,
        nodeType,
        JSON.stringify(inputData),
        ExecutionStatus.PENDING,
      ]
    );

    return result.rows[0].id;
  }

  /**
   * Update node execution record
   */
  private async updateNodeExecution(
    nodeExecutionId: string,
    result: any
  ): Promise<void> {
    // Custom JSON replacer to handle BigInt values
    const jsonReplacer = (_key: string, value: any) => {
      return typeof value === 'bigint' ? value.toString() : value;
    };

    await pool.query(
      `UPDATE node_executions SET
        output_data = $1,
        status = $2,
        error = $3,
        completed_at = $4,
        duration_ms = $5
      WHERE id = $6`,
      [
        JSON.stringify(result.output, jsonReplacer),
        result.success ? ExecutionStatus.SUCCESS : ExecutionStatus.FAILED,
        result.error ? JSON.stringify(result.error, jsonReplacer) : null,
        result.metadata.completedAt,
        result.metadata.duration,
        nodeExecutionId,
      ]
    );
  }

  /**
   * Update workflow last executed timestamp
   */
  private async updateWorkflowLastExecuted(workflowId: string): Promise<void> {
    await pool.query(
      'UPDATE workflows SET last_executed_at = NOW() WHERE id = $1',
      [workflowId]
    );
  }

  /**
   * Get execution by ID
   */
  async getExecution(executionId: string): Promise<DBWorkflowExecution | null> {
    const result = await pool.query<DBWorkflowExecution>(
      'SELECT * FROM workflow_executions WHERE id = $1',
      [executionId]
    );

    return result.rows[0] || null;
  }

  /**
   * Get node executions for a workflow execution
   */
  async getNodeExecutions(executionId: string): Promise<DBNodeExecution[]> {
    const result = await pool.query<DBNodeExecution>(
      'SELECT * FROM node_executions WHERE execution_id = $1 ORDER BY started_at ASC',
      [executionId]
    );

    return result.rows;
  }
}

// Export singleton instance
export const workflowExecutionEngine = new WorkflowExecutionEngine();


