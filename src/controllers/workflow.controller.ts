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
import { UserModel } from '../models/users/user.model';
import crypto from 'crypto';

/**
 * Create a new workflow
 */
export const createWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get userId from auth middleware or request body (for testing)
    const userId = (req as any).user?.id || req.body.userId;
    const {
      name,
      description,
      nodes,
      edges,
      triggerNodeId,
      category,
      tags,
    } = req.body;

    // Validate required fields
    if (!userId) {
      throw new AppError(400, 'User ID is required', 'VALIDATION_ERROR', {
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

    logger.info({ userId, name, nodeCount: nodes.length, edgeCount: edges.length }, 'Creating workflow');

    // In production, this should be handled by auth middleware
    if (userId && userId.startsWith('demo-user-')) {
      try {
        await UserModel.findOrCreate({
          id: userId,
          address: `0x${crypto.randomBytes(20).toString('hex')}`,
          email: `${userId}@demo.local`,
          onboarded_at: new Date(),
        });
        logger.info({ userId }, 'Demo user auto-created or already exists');
      } catch (error: any) {
        // If user creation fails, check if user exists
        const existingUser = await UserModel.findById(userId);
        if (!existingUser) {
          logger.error({ error, userId }, 'Failed to auto-create demo user');
          throw new AppError(
            500,
            'Failed to create demo user',
            'USER_CREATION_ERROR',
            { userId, originalError: error.message }
          );
        }
        // User exists, continue
        logger.info({ userId }, 'Demo user already exists');
      }
    } else {
      // For non-demo users, verify they exist
      const existingUser = await UserModel.findById(userId);
      if (!existingUser) {
        throw new AppError(
          404,
          `User not found: ${userId}`,
          'USER_NOT_FOUND',
          { userId }
        );
      }
    }

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
    const userId = (req as any).user?.id;

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
 * List all workflows for a user
 */
export const listWorkflows = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { category, isActive, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM workflows WHERE user_id = $1';
    const params: any[] = [userId];
    let paramIndex = 2;

    if (category) {
      query += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (isActive !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(isActive === 'true');
      paramIndex++;
    }

    query += ' ORDER BY updated_at DESC';
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

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
 * Update workflow
 */
export const updateWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;
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
 * Delete workflow
 */
export const deleteWorkflow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;

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
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({
        success: false,
        error: { message: 'Invalid workflow id', code: 'BAD_REQUEST' },
      } as ApiResponse);
      return;
    }
    const userId = (req as any).user?.id || req.body?.userId;
    const { initialInput = {} } = req.body || {};

    logger.info({ workflowId: id, userId }, 'Manual workflow execution requested');

    // Verify workflow exists and belongs to user (or exists if no userId for testing)
    const workflowResult = userId
      ? await pool.query(
          'SELECT * FROM workflows WHERE id = $1 AND user_id = $2',
          [id, userId]
        )
      : await pool.query('SELECT * FROM workflows WHERE id = $1', [id]);

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
    const workflow = workflowResult.rows[0];
    const executionId = crypto.randomUUID();
    await enqueueWorkflowExecution({
      workflowId: id,
      userId: userId || workflow.user_id, // Use workflow's user_id if no userId provided
      triggeredBy: TriggerType.MANUAL,
      initialInput,
      executionId,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        executionId,
        status: ExecutionStatus.PENDING,
        message: 'Workflow execution queued',
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
    const userId = (req as any).user?.id;

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
    const userId = (req as any).user?.id;
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

