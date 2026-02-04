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

    logger.info({ userId, userWalletAddress, name, nodeCount: nodes.length, edgeCount: edges.length }, 'Creating workflow for authenticated user');

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create workflow
      const workflowResult = await client.query(
        `INSERT INTO workflows (
          user_id,
          name,
          description,
          trigger_node_id,
          is_active,
          is_draft,
          category,
          tags
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [userId, name, description, null, false, true, category, tags]
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
    const { name, description, isActive, isDraft, category, tags } = req.body;

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
    } = req.body;

    logger.info({ workflowId: id, userId, nodeCount: nodes?.length, edgeCount: edges?.length }, 'Full update workflow requested');

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if workflow exists and belongs to user
      const workflowCheck = await client.query(
        'SELECT id FROM workflows WHERE id = $1 AND user_id = $2',
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

      // Update workflow metadata
      const workflowResult = await client.query(
        `UPDATE workflows SET 
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          category = COALESCE($3, category),
          tags = COALESCE($4, tags),
          updated_at = NOW()
        WHERE id = $5 AND user_id = $6
        RETURNING *`,
        [name, description, category, tags, id, userId]
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
    const workflowId = Array.isArray(req.params.workflowId)
      ? req.params.workflowId[0]
      : req.params.workflowId;
    if (!workflowId) {
      res.status(400).json({ success: false, error: 'Invalid workflowId' });
      return;
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const { initialInput = {} } = req.body || {};

    logger.info({ workflowId, userId }, 'Manual workflow execution requested');

    // Verify workflow exists and belongs to authenticated user
    const workflowResult = await pool.query(
      'SELECT * FROM workflows WHERE id = $1 AND user_id = $2',
      [workflowId, userId]
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

    // Enqueue execution
    const executionId = crypto.randomUUID();
    await enqueueWorkflowExecution({
      workflowId: workflowId,
      userId,
      triggeredBy: TriggerType.MANUAL,
      initialInput,
      executionId,
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
