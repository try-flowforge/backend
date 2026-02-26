import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');


    // Drop and recreate constraint (idempotent)
    await client.query(`
      ALTER TABLE workflow_executions
      DROP CONSTRAINT IF EXISTS valid_triggered_by;
    `);

    await client.query(`
      ALTER TABLE workflow_executions
      ADD CONSTRAINT valid_triggered_by
      CHECK (triggered_by IN ('CRON', 'WEBHOOK', 'MANUAL', 'EVENT', 'TIME_BLOCK'));
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to update workflow_executions constraint');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');


    await client.query(`
      ALTER TABLE workflow_executions
      DROP CONSTRAINT IF EXISTS valid_triggered_by;
    `);

    await client.query(`
      ALTER TABLE workflow_executions
      ADD CONSTRAINT valid_triggered_by
      CHECK (triggered_by IN ('CRON', 'WEBHOOK', 'MANUAL', 'EVENT'));
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to revert workflow_executions constraint');
    throw error;
  } finally {
    client.release();
  }
};
