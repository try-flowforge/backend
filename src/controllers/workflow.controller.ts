import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { enqueueWorkflowExecution } from '../config/queues';
import { logger } from '../utils/logger';
import {
  ExecutionStatus,
  TriggerType,
  ApiResponse,
} from '../types';
import { AppError } from '../middleware/error-handler';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import crypto from 'crypto';
import { generateSubscriptionToken } from '../services/subscription-token.service';
import { WorkflowValidator } from '../services/workflow/WorkflowValidator';
import { ostiumDelegationService } from '../services/ostium/ostium-delegation.service';

/**
 * Translate placeholder node IDs in templates from frontend IDs to database UUIDs.
 * Replaces {{blocks.oldNodeId...}} with {{blocks.newUUID...}}
 */
function translatePlaceholderIds(text: string, idMap: Map<string, string>): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  return text.replace(/\{\{blocks\.([^.}]+)/g, (match, nodeId) => {
    const realId = idMap.get(nodeId);
    return realId ? `{{blocks.${realId}` : match;
  });
}

/**
 * Translate all placeholder IDs in a node config object
 */
function translateNodeConfigPlaceholders(
  config: Record<string, any>,
  idMap: Map<string, string>
): Record<string, any> {
  const newConfig = { ...config };

  // Fields that may contain template placeholders
  const templateFields = [
    'userPromptTemplate',
    'message',
    'body',
    'subject',
  ];

  for (const field of templateFields) {
    if (newConfig[field] && typeof newConfig[field] === 'string') {
      newConfig[field] = translatePlaceholderIds(newConfig[field], idMap);
    }
  }

  return newConfig;
}

/**
 * Create a new workflow
 */
export const createWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get userId from the authenticated request (set by Privy auth middleware)
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const userWalletAddress = authReq.userWalletAddress;

    const {
      name,
      description,
      nodes,
      edges,
      triggerNodeId,
      category,
      tags,
      isPublic,
    } = req.body;

    // Validate required fields - userId should always be present from auth middleware
    if (!userId) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED', {
        field: 'userId',
      });
    }

    if (!name) {
      throw new AppError(400, 'Workflow name is required', 'VALIDATION_ERROR', {
        field: 'name',
      });
    }

    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      throw new AppError(
        400,
        'At least one node is required',
        'VALIDATION_ERROR',
        { field: 'nodes' }
      );
    }

    if (!edges || !Array.isArray(edges)) {
      throw new AppError(400, 'Edges must be an array', 'VALIDATION_ERROR', {
        field: 'edges',
      });
    }

    // Graph Integrity Validation
    WorkflowValidator.validate({ nodes, edges });

    logger.info({ userId, userWalletAddress, name, nodeCount: nodes.length, edgeCount: edges.length }, 'Creating workflow for authenticated user');

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create workflow
      const publishedAt = isPublic ? new Date() : null;
      const workflowResult = await client.query(
        `INSERT INTO workflows (
          user_id,
          name,
          description,
          trigger_node_id,
          is_active,
          is_draft,
          category,
          tags,
          is_public,
          published_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [userId, name, description, null, false, true, category, tags, isPublic || false, publishedAt]
      );

      const workflow = workflowResult.rows[0];
      const workflowId = workflow.id;

      // Create nodes
      const nodeIds = new Map<string, string>(); // temp ID -> real ID

      for (const node of nodes) {
        const nodeResult = await client.query(
          `INSERT INTO workflow_nodes (
            workflow_id,
            type,
            name,
            description,
            config,
            position,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id`,
          [
            workflowId,
            node.type,
            node.name,
            node.description,
            JSON.stringify(node.config),
            JSON.stringify(node.position),
            JSON.stringify(node.metadata),
          ]
        );

        nodeIds.set(node.id, nodeResult.rows[0].id);
      }

      // Translate placeholder IDs in node configs (after all nodes have UUIDs)
      for (const node of nodes) {
        const realNodeId = nodeIds.get(node.id);
        if (realNodeId && node.config) {
          const translatedConfig = translateNodeConfigPlaceholders(node.config, nodeIds);
          await client.query(
            'UPDATE workflow_nodes SET config = $1 WHERE id = $2',
            [JSON.stringify(translatedConfig), realNodeId]
          );
        }
      }

      // Update trigger node ID
      if (triggerNodeId) {
        const realTriggerNodeId = nodeIds.get(triggerNodeId);
        await client.query(
          'UPDATE workflows SET trigger_node_id = $1 WHERE id = $2',
          [realTriggerNodeId, workflowId]
        );
      }

      // Create edges
      for (const edge of edges) {
        const realSourceId = nodeIds.get(edge.sourceNodeId);
        const realTargetId = nodeIds.get(edge.targetNodeId);

        // Validate that both source and target nodes exist
        if (!realSourceId) {
          throw new AppError(
            400,
            `Source node not found: ${edge.sourceNodeId}`,
            'VALIDATION_ERROR',
            { edge, sourceNodeId: edge.sourceNodeId }
          );
        }

        if (!realTargetId) {
          throw new AppError(
            400,
            `Target node not found: ${edge.targetNodeId}`,
            'VALIDATION_ERROR',
            { edge, targetNodeId: edge.targetNodeId }
          );
        }

        await client.query(
          `INSERT INTO workflow_edges (
            workflow_id,
            source_node_id,
            target_node_id,
            source_handle,
            target_handle,
            condition,
            data_mapping
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            workflowId,
            realSourceId,
            realTargetId,
            edge.sourceHandle || null,
            edge.targetHandle || null,
            edge.condition ? JSON.stringify(edge.condition) : null,
            edge.dataMapping ? JSON.stringify(edge.dataMapping) : null,
          ]
        );
      }

      await client.query('COMMIT');

      logger.info({ workflowId }, 'Workflow created successfully');

      const response: ApiResponse = {
        success: true,
        data: {
          id: workflowId,
          ...workflow,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(201).json(response);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, userId, name }, 'Error creating workflow in transaction');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const userId = (req as any).user?.id || req.body?.userId;
    logger.error({ error, userId, body: req.body }, 'Error in createWorkflow');

    // If it's already an AppError, just pass it along
    if (error instanceof AppError) {
      return next(error);
    }

    // Handle database errors
    if (error && typeof error === 'object' && 'code' in error) {
      const dbError = error as any;
      if (dbError.code === '23503') {
        // Foreign key constraint violation
        return next(
          new AppError(
            400,
            'Invalid reference: node or workflow reference does not exist',
            'DATABASE_ERROR',
            { code: dbError.code, detail: dbError.detail }
          )
        );
      }
      if (dbError.code === '23505') {
        // Unique constraint violation
        return next(
          new AppError(
            409,
            'Workflow with this name already exists',
            'DUPLICATE_ERROR',
            { code: dbError.code, detail: dbError.detail }
          )
        );
      }
    }

    // Generic error handling
    next(error);
  }
};

/**
 * Validate a workflow without saving it
 */
export const validateWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { nodes, edges } = req.body;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    // This will throw AppError if validation fails
    WorkflowValidator.validate({ nodes, edges });

    // Additional runtime preflight for PERPS write actions: delegation must be ACTIVE.
    const perpsWriteActions = new Set(['OPEN_POSITION', 'CLOSE_POSITION', 'UPDATE_SL', 'UPDATE_TP']);
    if (userId && Array.isArray(nodes)) {
      for (const node of nodes) {
        if (node?.type !== 'PERPS') {
          continue;
        }

        const config = (node?.config || {}) as {
          action?: string;
          network?: 'testnet' | 'mainnet';
        };

        if (!config.action || !perpsWriteActions.has(config.action)) {
          continue;
        }

        const network = config.network || 'testnet';
        const status = await ostiumDelegationService.getStatus(userId, network);
        if (!status || status.status !== 'ACTIVE') {
          throw new AppError(
            400,
            `Ostium delegation is not active for ${network}. Approve delegation before running PERPS write actions.`,
            'VALIDATION_ERROR',
            [
              {
                field: 'nodes[].config.action',
                message: 'Delegation must be ACTIVE for Ostium OPEN/CLOSE/UPDATE actions',
              },
            ],
          );
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        valid: true,
        message: 'Workflow is valid',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get workflow by ID
 */
export const getWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    const workflowResult = await pool.query(
      'SELECT * FROM workflows WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (workflowResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const workflow = workflowResult.rows[0];

    // Get nodes
    const nodesResult = await pool.query(
      'SELECT * FROM workflow_nodes WHERE workflow_id = $1',
      [id]
    );

    // Get edges
    const edgesResult = await pool.query(
      'SELECT * FROM workflow_edges WHERE workflow_id = $1',
      [id]
    );

    const response: ApiResponse = {
      success: true,
      data: {
        ...workflow,
        nodes: nodesResult.rows,
        edges: edgesResult.rows,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * List all workflows for a user with execution statistics
 */
export const listWorkflows = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const { category, isActive, limit = 50, offset = 0 } = req.query;

    // Build the base query with execution statistics
    let query = `
      SELECT 
        w.*,
        COALESCE(exec_stats.execution_count, 0)::int as execution_count,
        exec_stats.last_execution_status,
        exec_stats.last_execution_at,
        COALESCE(exec_stats.success_count, 0)::int as success_count,
        COALESCE(exec_stats.failed_count, 0)::int as failed_count
      FROM workflows w
      LEFT JOIN (
        SELECT 
          workflow_id,
          COUNT(*)::int as execution_count,
          COUNT(*) FILTER (WHERE status = 'SUCCESS')::int as success_count,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int as failed_count,
          (
            SELECT status FROM workflow_executions we2 
            WHERE we2.workflow_id = workflow_executions.workflow_id 
            ORDER BY started_at DESC LIMIT 1
          ) as last_execution_status,
          MAX(started_at) as last_execution_at
        FROM workflow_executions
        GROUP BY workflow_id
      ) exec_stats ON w.id = exec_stats.workflow_id
      WHERE w.user_id = $1
    `;
    const params: any[] = [userId];
    let paramIndex = 2;

    if (category) {
      query += ` AND w.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (isActive !== undefined) {
      query += ` AND w.is_active = $${paramIndex}`;
      params.push(isActive === 'true');
      paramIndex++;
    }

    query += ' ORDER BY w.updated_at DESC';
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count for pagination (with same filters)
    let countQuery = `SELECT COUNT(*) FROM workflows w WHERE w.user_id = $1`;
    const countParams: any[] = [userId];
    let countParamIndex = 2;

    if (category) {
      countQuery += ` AND w.category = $${countParamIndex}`;
      countParams.push(category);
      countParamIndex++;
    }

    if (isActive !== undefined) {
      countQuery += ` AND w.is_active = $${countParamIndex}`;
      countParams.push(isActive === 'true');
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    const response: ApiResponse = {
      success: true,
      data: result.rows,
      meta: {
        timestamp: new Date().toISOString(),
        total: totalCount,
        limit: Number(limit),
        offset: Number(offset),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Update workflow
 */
export const updateWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const { name, description, isActive, isDraft, category, tags, isPublic } = req.body;

    const fields: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      fields.push(`name = $${paramIndex}`);
      values.push(name);
      paramIndex++;
    }

    if (description !== undefined) {
      fields.push(`description = $${paramIndex}`);
      values.push(description);
      paramIndex++;
    }

    if (isActive !== undefined) {
      fields.push(`is_active = $${paramIndex}`);
      values.push(isActive);
      paramIndex++;
    }

    if (isDraft !== undefined) {
      fields.push(`is_draft = $${paramIndex}`);
      values.push(isDraft);
      paramIndex++;
    }

    if (category !== undefined) {
      fields.push(`category = $${paramIndex}`);
      values.push(category);
      paramIndex++;
    }

    if (tags !== undefined) {
      fields.push(`tags = $${paramIndex}`);
      values.push(tags);
      paramIndex++;
    }

    if (isPublic !== undefined) {
      fields.push(`is_public = $${paramIndex}`);
      values.push(isPublic);
      paramIndex++;

      // Set or clear published_at based on isPublic
      if (isPublic) {
        fields.push(`published_at = COALESCE(published_at, NOW())`);
      } else {
        fields.push(`published_at = NULL`);
      }
    }

    values.push(id, userId);

    const result = await pool.query(
      `UPDATE workflows SET ${fields.join(', ')} 
       WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: result.rows[0],
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Full update workflow - replaces all nodes and edges
 * Used when saving workflow from the canvas
 */
export const fullUpdateWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const {
      name,
      description,
      nodes,
      edges,
      triggerNodeId,
      category,
      tags,
      isPublic,
    } = req.body;

    logger.info({ workflowId: id, userId, nodeCount: nodes?.length, edgeCount: edges?.length }, 'Full update workflow requested');

    // Graph Integrity Validation
    WorkflowValidator.validate({ nodes, edges });

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if workflow exists and belongs to user, get current version
      const workflowCheck = await client.query(
        'SELECT id, version, name, description, category, tags, is_public FROM workflows WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (workflowCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({
          success: false,
          error: {
            message: 'Workflow not found',
            code: 'WORKFLOW_NOT_FOUND',
          },
        } as ApiResponse);
        return;
      }

      const currentWorkflow = workflowCheck.rows[0];
      const currentVersion = currentWorkflow.version || 1;
      const newVersion = currentVersion + 1;

      // Get current nodes and edges for version snapshot
      const currentNodesResult = await client.query(
        'SELECT * FROM workflow_nodes WHERE workflow_id = $1',
        [id]
      );
      const currentEdgesResult = await client.query(
        'SELECT * FROM workflow_edges WHERE workflow_id = $1',
        [id]
      );

      // Save current state to version history (before updating)
      await client.query(
        `INSERT INTO workflow_version_history (
          workflow_id, 
          version_number, 
          change_summary,
          nodes_snapshot, 
          edges_snapshot,
          workflow_metadata,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (workflow_id, version_number) DO NOTHING`,
        [
          id,
          currentVersion,
          `Version ${currentVersion}`,
          JSON.stringify(currentNodesResult.rows),
          JSON.stringify(currentEdgesResult.rows),
          JSON.stringify({
            name: currentWorkflow.name,
            description: currentWorkflow.description,
            category: currentWorkflow.category,
            tags: currentWorkflow.tags,
            is_public: currentWorkflow.is_public,
          }),
          userId,
        ]
      );

      logger.info({ workflowId: id, currentVersion, newVersion }, 'Saving version snapshot before update');

      // Update workflow metadata
      let publishedAtClause = '';
      const updateParams: any[] = [name, description, category, tags];

      if (isPublic !== undefined) {
        if (isPublic) {
          // When publishing, set published_at if not already set
          publishedAtClause = ', is_public = $5, published_at = COALESCE(published_at, NOW())';
          updateParams.push(isPublic);
        } else {
          // When unpublishing, clear published_at
          publishedAtClause = ', is_public = $5, published_at = NULL';
          updateParams.push(isPublic);
        }
      }

      updateParams.push(id, userId);
      const paramCount = updateParams.length;

      const workflowResult = await client.query(
        `UPDATE workflows SET 
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          category = COALESCE($3, category),
          tags = COALESCE($4, tags),
          version = version + 1,
          version_created_at = NOW(),
          updated_at = NOW()
          ${publishedAtClause}
        WHERE id = $${paramCount - 1} AND user_id = $${paramCount}
        RETURNING *`,
        updateParams
      );

      const workflow = workflowResult.rows[0];

      // Delete existing edges first (due to foreign key constraints)
      await client.query('DELETE FROM workflow_edges WHERE workflow_id = $1', [id]);

      // Delete existing nodes
      await client.query('DELETE FROM workflow_nodes WHERE workflow_id = $1', [id]);

      // Create new nodes
      const nodeIds = new Map<string, string>(); // temp ID -> real ID

      if (nodes && Array.isArray(nodes)) {
        for (const node of nodes) {
          const nodeResult = await client.query(
            `INSERT INTO workflow_nodes (
              workflow_id,
              type,
              name,
              description,
              config,
              position,
              metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id`,
            [
              id,
              node.type,
              node.name,
              node.description,
              JSON.stringify(node.config || {}),
              JSON.stringify(node.position || { x: 0, y: 0 }),
              JSON.stringify(node.metadata || {}),
            ]
          );

          nodeIds.set(node.id, nodeResult.rows[0].id);
        }
      }

      // Translate placeholder IDs in node configs (after all nodes have UUIDs)
      if (nodes && Array.isArray(nodes)) {
        for (const node of nodes) {
          const realNodeId = nodeIds.get(node.id);
          if (realNodeId && node.config) {
            const translatedConfig = translateNodeConfigPlaceholders(node.config, nodeIds);
            await client.query(
              'UPDATE workflow_nodes SET config = $1 WHERE id = $2',
              [JSON.stringify(translatedConfig), realNodeId]
            );
          }
        }
      }

      // Update trigger node ID
      if (triggerNodeId) {
        const realTriggerNodeId = nodeIds.get(triggerNodeId);
        await client.query(
          'UPDATE workflows SET trigger_node_id = $1 WHERE id = $2',
          [realTriggerNodeId, id]
        );
      }

      // Create new edges
      if (edges && Array.isArray(edges)) {
        for (const edge of edges) {
          const realSourceId = nodeIds.get(edge.sourceNodeId);
          const realTargetId = nodeIds.get(edge.targetNodeId);

          if (!realSourceId || !realTargetId) {
            logger.warn({ edge }, 'Skipping edge with missing node reference');
            continue;
          }

          await client.query(
            `INSERT INTO workflow_edges (
              workflow_id,
              source_node_id,
              target_node_id,
              source_handle,
              target_handle,
              condition,
              data_mapping
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              id,
              realSourceId,
              realTargetId,
              edge.sourceHandle || null,
              edge.targetHandle || null,
              edge.condition ? JSON.stringify(edge.condition) : null,
              edge.dataMapping ? JSON.stringify(edge.dataMapping) : null,
            ]
          );
        }
      }

      await client.query('COMMIT');

      // Fetch the updated workflow with nodes and edges
      const nodesResult = await pool.query(
        'SELECT * FROM workflow_nodes WHERE workflow_id = $1',
        [id]
      );

      const edgesResult = await pool.query(
        'SELECT * FROM workflow_edges WHERE workflow_id = $1',
        [id]
      );

      logger.info({ workflowId: id }, 'Workflow fully updated successfully');

      const response: ApiResponse = {
        success: true,
        data: {
          ...workflow,
          nodes: nodesResult.rows,
          edges: edgesResult.rows,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, workflowId: id, userId }, 'Error in full update workflow transaction');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error({ error }, 'Error in fullUpdateWorkflow');
    next(error);
  }
};

/**
 * Delete workflow
 */
export const deleteWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    const result = await pool.query(
      'DELETE FROM workflows WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: { id },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Execute workflow manually
 */
export const executeWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const { initialInput = {} } = req.body || {};

    logger.info({ workflowId: id, userId }, 'Manual workflow execution requested');

    // Verify workflow exists and belongs to authenticated user
    const workflowResult = await pool.query(
      'SELECT * FROM workflows WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (workflowResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const workflow = workflowResult.rows[0];
    const versionNumber = workflow.version || 1;

    // Enqueue execution with version number
    const executionId = crypto.randomUUID();
    await enqueueWorkflowExecution({
      workflowId: id,
      userId,
      triggeredBy: TriggerType.MANUAL,
      initialInput,
      executionId,
      versionNumber,
    });

    // Generate subscription token for SSE access
    const subscriptionToken = await generateSubscriptionToken(executionId, userId);

    const response: ApiResponse = {
      success: true,
      data: {
        executionId,
        status: ExecutionStatus.PENDING,
        message: 'Workflow execution queued',
        subscriptionToken, // Token for SSE subscription
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(202).json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Get workflow execution status
 */
export const getExecutionStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { executionId } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    const execution = await pool.query(
      `SELECT we.*, w.name as workflow_name
       FROM workflow_executions we
       JOIN workflows w ON we.workflow_id = w.id
       WHERE we.id = $1 AND we.user_id = $2`,
      [executionId, userId]
    );

    if (execution.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Execution not found',
          code: 'EXECUTION_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    // Get node executions
    const nodeExecutions = await pool.query(
      'SELECT * FROM node_executions WHERE execution_id = $1 ORDER BY started_at ASC',
      [executionId]
    );

    const response: ApiResponse = {
      success: true,
      data: {
        ...execution.rows[0],
        nodeExecutions: nodeExecutions.rows,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Get workflow execution history
 */
export const getExecutionHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT * FROM workflow_executions 
       WHERE workflow_id = $1 AND user_id = $2 
       ORDER BY started_at DESC 
       LIMIT $3 OFFSET $4`,
      [id, userId, limit, offset]
    );

    const response: ApiResponse = {
      success: true,
      data: result.rows,
      meta: {
        timestamp: new Date().toISOString(),
        total: result.rows.length,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Sanitize node config for public display
 * Removes user-specific and sensitive identifiers
 */
function sanitizeNodeConfig(nodeType: string, config: Record<string, any>): Record<string, any> {
  const sanitized = { ...config };

  switch (nodeType) {
    case 'SLACK':
      delete sanitized.connectionId;
      delete sanitized.channelId;
      break;

    case 'TELEGRAM':
      delete sanitized.connectionId;
      delete sanitized.chatId;
      break;

    case 'EMAIL':
      delete sanitized.to;
      // Keep subject and body template structure
      break;

    case 'WALLET':
      delete sanitized.walletAddress;
      break;

    case 'SWAP':
      // Keep swap config but remove wallet address
      if (sanitized.inputConfig) {
        delete sanitized.inputConfig.walletAddress;
      }
      break;

    // Keep other node types as-is (IF, SWITCH, START, etc.)
    default:
      break;
  }

  return sanitized;
}

/**
 * List all public workflows (no authentication required)
 */
export const listPublicWorkflows = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { q, tag, limit = 50, offset = 0 } = req.query;

    // Build query with search and tag filters
    let query = `
      SELECT 
        w.id,
        w.name,
        w.description,
        w.category,
        w.tags,
        w.published_at,
        w.updated_at,
        w.created_at,
        COALESCE(exec_stats.execution_count, 0)::int as usage_count
      FROM workflows w
      LEFT JOIN (
        SELECT 
          workflow_id,
          COUNT(DISTINCT user_id)::int as execution_count
        FROM workflow_executions
        GROUP BY workflow_id
      ) exec_stats ON w.id = exec_stats.workflow_id
      WHERE w.is_public = true
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Search by name or description
    if (q && typeof q === 'string' && q.trim() !== '') {
      query += ` AND (w.name ILIKE $${paramIndex} OR w.description ILIKE $${paramIndex})`;
      params.push(`%${q.trim()}%`);
      paramIndex++;
    }

    // Filter by tag
    if (tag && typeof tag === 'string') {
      query += ` AND $${paramIndex} = ANY(w.tags)`;
      params.push(tag);
      paramIndex++;
    }

    query += ' ORDER BY w.published_at DESC NULLS LAST, w.updated_at DESC';
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM workflows w WHERE w.is_public = true';
    const countParams: any[] = [];
    let countParamIndex = 1;

    if (q && typeof q === 'string' && q.trim() !== '') {
      countQuery += ` AND (w.name ILIKE $${countParamIndex} OR w.description ILIKE $${countParamIndex})`;
      countParams.push(`%${q.trim()}%`);
      countParamIndex++;
    }

    if (tag && typeof tag === 'string') {
      countQuery += ` AND $${countParamIndex} = ANY(w.tags)`;
      countParams.push(tag);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    const response: ApiResponse = {
      success: true,
      data: result.rows,
      meta: {
        timestamp: new Date().toISOString(),
        total: totalCount,
        limit: Number(limit),
        offset: Number(offset),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single public workflow with sanitized node configs (no authentication required)
 */
export const getPublicWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Get workflow
    const workflowResult = await pool.query(
      'SELECT * FROM workflows WHERE id = $1 AND is_public = true',
      [id]
    );

    if (workflowResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Public workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const workflow = workflowResult.rows[0];

    // Get nodes
    const nodesResult = await pool.query(
      'SELECT * FROM workflow_nodes WHERE workflow_id = $1',
      [id]
    );

    // Sanitize node configs
    const sanitizedNodes = nodesResult.rows.map((node) => ({
      ...node,
      config: sanitizeNodeConfig(node.type, node.config || {}),
    }));

    // Get edges
    const edgesResult = await pool.query(
      'SELECT * FROM workflow_edges WHERE workflow_id = $1',
      [id]
    );

    // Remove user_id from workflow for privacy
    const { user_id, ...workflowData } = workflow;

    const response: ApiResponse = {
      success: true,
      data: {
        ...workflowData,
        nodes: sanitizedNodes,
        edges: edgesResult.rows,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Get version history for a public workflow (no authentication required)
 */
export const getPublicWorkflowVersions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Verify workflow is public
    const workflowResult = await pool.query(
      'SELECT id, version FROM workflows WHERE id = $1 AND is_public = true',
      [id]
    );

    if (workflowResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Public workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const currentVersion = workflowResult.rows[0].version || 1;

    // Get version history
    const versionsResult = await pool.query(
      `SELECT id, version_number, change_summary, created_at
       FROM workflow_version_history
       WHERE workflow_id = $1
       ORDER BY version_number DESC`,
      [id]
    );

    const response: ApiResponse = {
      success: true,
      data: {
        currentVersion,
        versions: versionsResult.rows,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific version of a public workflow (no authentication required)
 */
export const getPublicWorkflowVersion = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, versionNumber } = req.params;
    const versionStr = Array.isArray(versionNumber) ? versionNumber[0] : versionNumber;
    const parsedVersionNumber = parseInt(versionStr, 10);

    if (isNaN(parsedVersionNumber) || parsedVersionNumber < 1) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid version number',
          code: 'INVALID_VERSION_NUMBER',
        },
      } as ApiResponse);
      return;
    }

    // Verify workflow is public
    const workflowResult = await pool.query(
      'SELECT id, version, name, description, category, tags FROM workflows WHERE id = $1 AND is_public = true',
      [id]
    );

    if (workflowResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Public workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const currentVersion = workflowResult.rows[0].version || 1;

    // If requesting current version, return current workflow
    if (parsedVersionNumber === currentVersion) {
      // Get current nodes
      const nodesResult = await pool.query(
        'SELECT * FROM workflow_nodes WHERE workflow_id = $1',
        [id]
      );

      // Sanitize node configs
      const sanitizedNodes = nodesResult.rows.map((node) => ({
        ...node,
        config: sanitizeNodeConfig(node.type, node.config || {}),
      }));

      // Get edges
      const edgesResult = await pool.query(
        'SELECT * FROM workflow_edges WHERE workflow_id = $1',
        [id]
      );

      const response: ApiResponse = {
        success: true,
        data: {
          versionNumber: currentVersion,
          isCurrent: true,
          nodes: sanitizedNodes,
          edges: edgesResult.rows,
          metadata: {
            name: workflowResult.rows[0].name,
            description: workflowResult.rows[0].description,
          },
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
      return;
    }

    // Get historical version
    const versionResult = await pool.query(
      `SELECT * FROM workflow_version_history
       WHERE workflow_id = $1 AND version_number = $2`,
      [id, parsedVersionNumber]
    );

    if (versionResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Version not found',
          code: 'VERSION_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const version = versionResult.rows[0];

    // Sanitize nodes in snapshot
    const sanitizedNodes = (version.nodes_snapshot || []).map((node: any) => ({
      ...node,
      config: sanitizeNodeConfig(node.type, node.config || {}),
    }));

    const response: ApiResponse = {
      success: true,
      data: {
        versionNumber: parsedVersionNumber,
        isCurrent: false,
        nodes: sanitizedNodes,
        edges: version.edges_snapshot || [],
        metadata: version.workflow_metadata || {},
        createdAt: version.created_at,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Clone a public workflow to the authenticated user's account
 */
export const clonePublicWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    if (!userId) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get the public workflow
      const workflowResult = await client.query(
        'SELECT * FROM workflows WHERE id = $1 AND is_public = true',
        [id]
      );

      if (workflowResult.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({
          success: false,
          error: {
            message: 'Public workflow not found',
            code: 'WORKFLOW_NOT_FOUND',
          },
        } as ApiResponse);
        return;
      }

      const sourceWorkflow = workflowResult.rows[0];

      // Create new workflow (as private, owned by the cloning user)
      const newWorkflowResult = await client.query(
        `INSERT INTO workflows (
          user_id,
          name,
          description,
          trigger_node_id,
          is_active,
          is_draft,
          category,
          tags,
          is_public,
          published_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          userId,
          `${sourceWorkflow.name} (Copy)`,
          sourceWorkflow.description,
          null, // Will update after cloning nodes
          false,
          true,
          sourceWorkflow.category,
          sourceWorkflow.tags,
          false, // Clone as private
          null,
        ]
      );

      const newWorkflow = newWorkflowResult.rows[0];
      const newWorkflowId = newWorkflow.id;

      // Get source nodes
      const nodesResult = await client.query(
        'SELECT * FROM workflow_nodes WHERE workflow_id = $1',
        [id]
      );

      // Clone nodes with sanitized configs
      const nodeIdMap = new Map<string, string>();

      for (const node of nodesResult.rows) {
        // Sanitize config when cloning
        const sanitizedConfig = sanitizeNodeConfig(node.type, node.config || {});

        const newNodeResult = await client.query(
          `INSERT INTO workflow_nodes (
            workflow_id,
            type,
            name,
            description,
            config,
            position,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id`,
          [
            newWorkflowId,
            node.type,
            node.name,
            node.description,
            JSON.stringify(sanitizedConfig),
            node.position,
            node.metadata,
          ]
        );

        nodeIdMap.set(node.id, newNodeResult.rows[0].id);
      }

      // Update trigger node ID if exists
      if (sourceWorkflow.trigger_node_id) {
        const newTriggerNodeId = nodeIdMap.get(sourceWorkflow.trigger_node_id);
        if (newTriggerNodeId) {
          await client.query(
            'UPDATE workflows SET trigger_node_id = $1 WHERE id = $2',
            [newTriggerNodeId, newWorkflowId]
          );
        }
      }

      // Get source edges
      const edgesResult = await client.query(
        'SELECT * FROM workflow_edges WHERE workflow_id = $1',
        [id]
      );

      // Clone edges
      for (const edge of edgesResult.rows) {
        const newSourceId = nodeIdMap.get(edge.source_node_id);
        const newTargetId = nodeIdMap.get(edge.target_node_id);

        if (newSourceId && newTargetId) {
          await client.query(
            `INSERT INTO workflow_edges (
              workflow_id,
              source_node_id,
              target_node_id,
              source_handle,
              target_handle,
              condition,
              data_mapping
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              newWorkflowId,
              newSourceId,
              newTargetId,
              edge.source_handle,
              edge.target_handle,
              edge.condition,
              edge.data_mapping,
            ]
          );
        }
      }

      await client.query('COMMIT');

      logger.info({ sourceWorkflowId: id, newWorkflowId, userId }, 'Public workflow cloned successfully');

      const response: ApiResponse = {
        success: true,
        data: {
          id: newWorkflowId,
          ...newWorkflow,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(201).json(response);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, workflowId: id, userId }, 'Error cloning public workflow');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error({ error }, 'Error in clonePublicWorkflow');
    next(error);
  }
};

/**
 * Get workflow version history
 */
export const getWorkflowVersions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    // Verify workflow exists and belongs to user
    const workflowCheck = await pool.query(
      'SELECT id, version FROM workflows WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (workflowCheck.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const currentVersion = workflowCheck.rows[0].version || 1;

    // Get version history
    const versionsResult = await pool.query(
      `SELECT 
        id,
        version_number,
        change_summary,
        created_at,
        created_by
      FROM workflow_version_history 
      WHERE workflow_id = $1 
      ORDER BY version_number DESC`,
      [id]
    );

    const response: ApiResponse = {
      success: true,
      data: {
        currentVersion,
        versions: versionsResult.rows,
      },
      meta: {
        timestamp: new Date().toISOString(),
        total: versionsResult.rows.length,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, 'Error in getWorkflowVersions');
    next(error);
  }
};

/**
 * Get specific workflow version
 */
export const getWorkflowVersion = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, versionNumber } = req.params;
    const versionStr = Array.isArray(versionNumber) ? versionNumber[0] : versionNumber;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    // Verify workflow exists and belongs to user
    const workflowCheck = await pool.query(
      'SELECT id FROM workflows WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (workflowCheck.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    // Get specific version
    const versionResult = await pool.query(
      `SELECT * FROM workflow_version_history 
       WHERE workflow_id = $1 AND version_number = $2`,
      [id, parseInt(versionStr, 10)]
    );

    if (versionResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Version not found',
          code: 'VERSION_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const version = versionResult.rows[0];

    const response: ApiResponse = {
      success: true,
      data: {
        id: version.id,
        workflowId: id,
        versionNumber: version.version_number,
        changeSummary: version.change_summary,
        nodes: version.nodes_snapshot,
        edges: version.edges_snapshot,
        metadata: version.workflow_metadata,
        createdAt: version.created_at,
        createdBy: version.created_by,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, 'Error in getWorkflowVersion');
    next(error);
  }
};

/**
 * Restore workflow to a previous version
 */
export const restoreWorkflowVersion = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, versionNumber } = req.params;
    const versionStr = Array.isArray(versionNumber) ? versionNumber[0] : versionNumber;
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    // Parse and validate version number
    const parsedVersionNumber = parseInt(versionStr, 10);
    if (isNaN(parsedVersionNumber) || parsedVersionNumber < 1) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid version number',
          code: 'INVALID_VERSION_NUMBER',
        },
      } as ApiResponse);
      return;
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Verify workflow exists and belongs to user
      const workflowCheck = await client.query(
        'SELECT id, version, name, description, category, tags, is_public FROM workflows WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (workflowCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({
          success: false,
          error: {
            message: 'Workflow not found',
            code: 'WORKFLOW_NOT_FOUND',
          },
        } as ApiResponse);
        return;
      }

      const currentWorkflow = workflowCheck.rows[0];
      const currentVersion = currentWorkflow.version || 1;

      // Block rollback for public workflows
      if (currentWorkflow.is_public) {
        await client.query('ROLLBACK');
        res.status(403).json({
          success: false,
          error: {
            message: 'Cannot rollback public workflows. Unpublish the workflow first.',
            code: 'ROLLBACK_PUBLIC_FORBIDDEN',
          },
        } as ApiResponse);
        return;
      }

      // Get version to restore
      const versionResult = await client.query(
        `SELECT * FROM workflow_version_history 
         WHERE workflow_id = $1 AND version_number = $2`,
        [id, parsedVersionNumber]
      );

      if (versionResult.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({
          success: false,
          error: {
            message: 'Version not found',
            code: 'VERSION_NOT_FOUND',
          },
        } as ApiResponse);
        return;
      }

      const versionToRestore = versionResult.rows[0];

      // Get current nodes and edges for snapshot
      const currentNodesResult = await client.query(
        'SELECT * FROM workflow_nodes WHERE workflow_id = $1',
        [id]
      );
      const currentEdgesResult = await client.query(
        'SELECT * FROM workflow_edges WHERE workflow_id = $1',
        [id]
      );

      // Save current state to version history before restoring
      await client.query(
        `INSERT INTO workflow_version_history (
          workflow_id, 
          version_number, 
          change_summary,
          nodes_snapshot, 
          edges_snapshot,
          workflow_metadata,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (workflow_id, version_number) DO NOTHING`,
        [
          id,
          currentVersion,
          `Before restoring to version ${versionNumber}`,
          JSON.stringify(currentNodesResult.rows),
          JSON.stringify(currentEdgesResult.rows),
          JSON.stringify({
            name: currentWorkflow.name,
            description: currentWorkflow.description,
            category: currentWorkflow.category,
            tags: currentWorkflow.tags,
            is_public: currentWorkflow.is_public,
          }),
          userId,
        ]
      );

      // Delete current edges and nodes
      await client.query('DELETE FROM workflow_edges WHERE workflow_id = $1', [id]);
      await client.query('DELETE FROM workflow_nodes WHERE workflow_id = $1', [id]);

      // Restore nodes from snapshot
      const restoredNodes = versionToRestore.nodes_snapshot;
      const nodeIdMap = new Map<string, string>();

      for (const node of restoredNodes) {
        const result = await client.query(
          `INSERT INTO workflow_nodes (
            workflow_id, type, name, description, config, position, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            id,
            node.type,
            node.name,
            node.description,
            JSON.stringify(node.config),
            JSON.stringify(node.position),
            JSON.stringify(node.metadata),
          ]
        );
        nodeIdMap.set(node.id, result.rows[0].id);
      }

      // Restore edges from snapshot
      const restoredEdges = versionToRestore.edges_snapshot;
      for (const edge of restoredEdges) {
        const sourceId = nodeIdMap.get(edge.source_node_id);
        const targetId = nodeIdMap.get(edge.target_node_id);

        if (sourceId && targetId) {
          await client.query(
            `INSERT INTO workflow_edges (
              workflow_id, source_node_id, target_node_id, source_handle, target_handle, condition, data_mapping
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              id,
              sourceId,
              targetId,
              edge.source_handle,
              edge.target_handle,
              edge.condition ? JSON.stringify(edge.condition) : null,
              edge.data_mapping ? JSON.stringify(edge.data_mapping) : null,
            ]
          );
        }
      }

      // Update workflow version to the restored version (true rollback)
      const workflowMetadata = versionToRestore.workflow_metadata || {};

      await client.query(
        `UPDATE workflows SET 
          version = $1,
          version_created_at = NOW(),
          updated_at = NOW(),
          name = COALESCE($2, name),
          description = COALESCE($3, description)
        WHERE id = $4`,
        [parsedVersionNumber, workflowMetadata.name, workflowMetadata.description, id]
      );

      // Delete version history entries newer than the restored version
      await client.query(
        `DELETE FROM workflow_version_history 
         WHERE workflow_id = $1 AND version_number > $2`,
        [id, parsedVersionNumber]
      );

      await client.query('COMMIT');

      logger.info({ workflowId: id, restoredToVersion: parsedVersionNumber }, 'Workflow version restored (rollback)');

      const response: ApiResponse = {
        success: true,
        data: {
          workflowId: id,
          restoredToVersion: parsedVersionNumber,
          message: `Workflow rolled back to version ${parsedVersionNumber}`,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, workflowId: id, versionNumber }, 'Error restoring workflow version');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error({ error }, 'Error in restoreWorkflowVersion');
    next(error);
  }
};
