import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error-handler';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import crypto from 'crypto';
import {
  cancelTimeBlockJob,
  scheduleTimeBlockJob,
} from '../services/timeblock/timeblock-scheduler';
import { TimeBlockRecurrenceType, TimeBlockStatus } from '../types';

export const createTimeBlock = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    if (!userId) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const { workflowId, runAt, timezone, recurrence } = req.body as any;

    const recurrenceType: TimeBlockRecurrenceType =
      recurrence?.type || TimeBlockRecurrenceType.NONE;

    const intervalSeconds: number | null =
      recurrenceType === TimeBlockRecurrenceType.INTERVAL
        ? Number(recurrence.intervalSeconds)
        : null;

    const cronExpression: string | null =
      recurrenceType === TimeBlockRecurrenceType.CRON
        ? String(recurrence.cronExpression)
        : null;

    const untilAt: Date | null = recurrence?.untilAt
      ? new Date(recurrence.untilAt)
      : null;

    const maxRuns: number | null =
      recurrence?.maxRuns !== undefined && recurrence?.maxRuns !== null
        ? Number(recurrence.maxRuns)
        : null;

    const runAtDate = new Date(runAt);
    if (Number.isNaN(runAtDate.getTime())) {
      throw new AppError(400, 'Invalid runAt datetime', 'VALIDATION_ERROR', {
        field: 'runAt',
      });
    }

    const id = crypto.randomUUID();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insert = await client.query(
        `
        INSERT INTO time_blocks (
          id, user_id, workflow_id, run_at, timezone,
          recurrence_type, interval_seconds, cron_expression,
          until_at, max_runs, status
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11
        )
        RETURNING *
        `,
        [
          id,
          userId,
          workflowId,
          runAtDate.toISOString(),
          timezone || null,
          recurrenceType,
          intervalSeconds,
          cronExpression,
          untilAt ? untilAt.toISOString() : null,
          maxRuns,
          TimeBlockStatus.ACTIVE,
        ]
      );

      await client.query('COMMIT');

      // Schedule after commit so we don't enqueue jobs for rolled back records
      await scheduleTimeBlockJob({
        id,
        workflowId,
        userId,
        runAt: runAtDate,
        recurrenceType: recurrenceType,
        intervalSeconds,
        cronExpression,
        timezone: timezone || null,
        untilAt,
      });

      res.status(201).json({
        success: true,
        data: insert.rows[0],
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error({ error }, 'Failed to create time block');
    next(error);
  }
};

export const listTimeBlocks = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;

    if (!userId) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const status = (req.query.status as string | undefined) || undefined;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);

    const params: any[] = [userId];
    let where = 'WHERE user_id = $1';
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    params.push(limit);
    params.push(offset);

    const result = await pool.query(
      `
      SELECT *
      FROM time_blocks
      ${where}
      ORDER BY run_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );

    res.status(200).json({
      success: true,
      data: result.rows,
      meta: { timestamp: new Date().toISOString(), limit, offset, total: result.rows.length },
    });
  } catch (error) {
    logger.error({ error }, 'Failed to list time blocks');
    next(error);
  }
};

export const getTimeBlock = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const id = req.params.id as string;

    if (!userId) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const result = await pool.query(
      'SELECT * FROM time_blocks WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rows.length === 0) {
      throw new AppError(404, 'Time block not found', 'NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get time block');
    next(error);
  }
};

export const cancelTimeBlock = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const id = req.params.id as string;

    if (!userId) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updated = await client.query(
        `
        UPDATE time_blocks
        SET status = $1, cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $2 AND user_id = $3 AND status <> $1
        RETURNING *
        `,
        [TimeBlockStatus.CANCELLED, id, userId]
      );

      if (updated.rows.length === 0) {
        // Ensure existence (and ownership)
        const existing = await client.query(
          'SELECT id FROM time_blocks WHERE id = $1 AND user_id = $2',
          [id, userId]
        );
        if (existing.rows.length === 0) {
          throw new AppError(404, 'Time block not found', 'NOT_FOUND');
        }
      }

      await client.query('COMMIT');

      await cancelTimeBlockJob(id);

      res.status(200).json({
        success: true,
        data: updated.rows[0] || { id, status: TimeBlockStatus.CANCELLED },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error({ error }, 'Failed to cancel time block');
    next(error);
  }
};

