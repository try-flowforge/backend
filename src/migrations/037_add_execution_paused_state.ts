import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Update status CHECK constraints for all execution tables
    // PostgreSQL doesn't allow direct ALTER CONSTRAINT to change the check expression easily,
    // so we drop and recreate the constraints.

    const newStatusValues = "'PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'RETRYING', 'WAITING_FOR_SIGNATURE'";

    // workflow_executions
    await client.query(`ALTER TABLE workflow_executions DROP CONSTRAINT IF EXISTS valid_status`);
    await client.query(`ALTER TABLE workflow_executions ADD CONSTRAINT valid_status CHECK (status IN (${newStatusValues}))`);

    // node_executions
    await client.query(`ALTER TABLE node_executions DROP CONSTRAINT IF EXISTS valid_status`);
    await client.query(`ALTER TABLE node_executions ADD CONSTRAINT valid_status CHECK (status IN (${newStatusValues}))`);

    // swap_executions
    await client.query(`ALTER TABLE swap_executions DROP CONSTRAINT IF EXISTS valid_status`);
    await client.query(`ALTER TABLE swap_executions ADD CONSTRAINT valid_status CHECK (status IN (${newStatusValues}))`);

    // lending_executions (uses a different constraint name)
    await client.query(`ALTER TABLE lending_executions DROP CONSTRAINT IF EXISTS valid_lending_status`);
    await client.query(`ALTER TABLE lending_executions ADD CONSTRAINT valid_lending_status CHECK (status IN (${newStatusValues}))`);

    // 2. Add paused-execution columns to workflow_executions
    await client.query(`
            ALTER TABLE workflow_executions
            ADD COLUMN IF NOT EXISTS paused_at_node_id TEXT,
            ADD COLUMN IF NOT EXISTS paused_context JSONB,
            ADD COLUMN IF NOT EXISTS safe_tx_hash TEXT,
            ADD COLUMN IF NOT EXISTS safe_tx_data JSONB;
        `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Migration failed: 037_add_execution_paused_state');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const oldStatusValues = "'PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'RETRYING'";

    // workflow_executions
    await client.query(`ALTER TABLE workflow_executions DROP CONSTRAINT IF EXISTS valid_status`);
    await client.query(`ALTER TABLE workflow_executions ADD CONSTRAINT valid_status CHECK (status IN (${oldStatusValues}))`);

    // node_executions
    await client.query(`ALTER TABLE node_executions DROP CONSTRAINT IF EXISTS valid_status`);
    await client.query(`ALTER TABLE node_executions ADD CONSTRAINT valid_status CHECK (status IN (${oldStatusValues}))`);

    // swap_executions
    await client.query(`ALTER TABLE swap_executions DROP CONSTRAINT IF EXISTS valid_status`);
    await client.query(`ALTER TABLE swap_executions ADD CONSTRAINT valid_status CHECK (status IN (${oldStatusValues}))`);

    // lending_executions
    await client.query(`ALTER TABLE lending_executions DROP CONSTRAINT IF EXISTS valid_lending_status`);
    await client.query(`ALTER TABLE lending_executions ADD CONSTRAINT valid_lending_status CHECK (status IN (${oldStatusValues}))`);

    await client.query(`
            ALTER TABLE workflow_executions
            DROP COLUMN IF EXISTS paused_at_node_id,
            DROP COLUMN IF EXISTS paused_context,
            DROP COLUMN IF EXISTS safe_tx_hash,
            DROP COLUMN IF EXISTS safe_tx_data;
        `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Rollback failed: 037_add_execution_paused_state');
    throw error;
  } finally {
    client.release();
  }
};
