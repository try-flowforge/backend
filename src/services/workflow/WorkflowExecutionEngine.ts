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
    initialInput?: Record<string, any>
  ): Promise<WorkflowExecutionContext> {
    logger.info({ workflowId, userId, triggeredBy }, 'Starting workflow execution');

    // Create execution context
    const executionId = await this.createWorkflowExecution(
      workflowId,
      userId,
      triggeredBy,
      initialInput
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

      // Build execution graph
      const executionOrder = this.buildExecutionOrder(workflow);

      // Execute nodes in order
      for (const nodeId of executionOrder) {
        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) continue;

        // Skip TRIGGER nodes - they're just entry points
        if (node.type === NodeType.TRIGGER) {
          logger.debug({ nodeId, type: node.type }, 'Skipping trigger node');
          continue;
        }

        logger.debug({ nodeId, type: node.type }, 'Executing node');

        // Get input data from previous nodes
        const inputData = this.collectInputData(node.id, workflow, context);

        // Create node execution record
        const nodeExecutionId = await this.createNodeExecution(
          executionId,
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
          secrets: await this.loadUserSecrets(userId),
        };

        const processor = nodeProcessorFactory.getProcessor(node.type);
        const result = await processor.execute(nodeInput);

        // Update node execution record
        await this.updateNodeExecution(nodeExecutionId, result);

        // Store output in context
        context.nodeOutputs.set(node.id, result.output);
        context.currentNodeId = node.id;

        // Check if node failed
        if (!result.success) {
          logger.error({ nodeId, error: result.error }, 'Node execution failed');

          // Check if we should continue or stop
          if (!(node.config as any).continueOnError) {
            context.status = ExecutionStatus.FAILED;
            context.error = result.error;
            context.completedAt = new Date();
            break;
          }
        }
      }

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

      logger.info(
        {
          executionId,
          status: context.status,
          duration: context.completedAt
            ? context.completedAt.getTime() - context.startedAt.getTime()
            : null,
        },
        'Workflow execution completed'
      );

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
   * Build execution order from workflow graph (topological sort)
   */
  private buildExecutionOrder(workflow: WorkflowDefinition): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      if (visiting.has(nodeId)) {
        throw new Error('Circular dependency detected in workflow');
      }

      visiting.add(nodeId);

      // Get all incoming edges
      const incomingEdges = workflow.edges.filter(e => e.targetNodeId === nodeId);

      // Visit dependencies first
      for (const edge of incomingEdges) {
        visit(edge.sourceNodeId);
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
      order.push(nodeId);
    };

    // Start from trigger node
    if (workflow.triggerNodeId) {
      visit(workflow.triggerNodeId);
    }

    // Visit any remaining unvisited nodes
    for (const node of workflow.nodes) {
      if (!visited.has(node.id)) {
        visit(node.id);
      }
    }

    return order;
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

    // Collect outputs from predecessor nodes
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

    return inputData;
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

    // For now, return empty object
    // In production, this would load and decrypt:
    // - Wallet private keys
    // - API keys for providers
    // - Other sensitive credentials

    return {
      // WALLET_PRIVATE_KEY: await decryptSecret(userId, 'wallet_private_key'),
    };
  }

  /**
   * Create workflow execution record
   */
  private async createWorkflowExecution(
    workflowId: string,
    userId: string,
    triggeredBy: TriggerType,
    initialInput?: Record<string, any>
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO workflow_executions (
        workflow_id,
        user_id,
        triggered_by,
        initial_input,
        status
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id`,
      [
        workflowId,
        userId,
        triggeredBy,
        initialInput ? JSON.stringify(initialInput) : null,
        ExecutionStatus.PENDING,
      ]
    );

    return result.rows[0].id;
  }

  /**
   * Update execution status
   */
  private async updateExecutionStatus(
    executionId: string,
    status: ExecutionStatus,
    error?: any
  ): Promise<void> {
    const fields = ['status = $1'];
    const values: any[] = [status];
    let paramIndex = 2;

    if (error) {
      fields.push(`error = $${paramIndex}`);
      values.push(JSON.stringify(error));
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
    await pool.query(
      `UPDATE node_executions SET
        output_data = $1,
        status = $2,
        error = $3,
        completed_at = $4,
        duration_ms = $5
      WHERE id = $6`,
      [
        JSON.stringify(result.output),
        result.success ? ExecutionStatus.SUCCESS : ExecutionStatus.FAILED,
        result.error ? JSON.stringify(result.error) : null,
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

