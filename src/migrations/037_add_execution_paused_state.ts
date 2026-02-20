import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
    logger.info('Running migration: 037_add_execution_paused_state');

    // 1. Add WAITING_FOR_SIGNATURE to the execution_status enum
    await pool.query(`
    ALTER TYPE execution_status ADD VALUE IF NOT EXISTS 'WAITING_FOR_SIGNATURE';
  `);

    // 2. Add paused-execution columns to workflow_executions
    await pool.query(`
    ALTER TABLE workflow_executions
      ADD COLUMN IF NOT EXISTS paused_at_node_id TEXT,
      ADD COLUMN IF NOT EXISTS paused_context JSONB,
      ADD COLUMN IF NOT EXISTS safe_tx_hash TEXT,
      ADD COLUMN IF NOT EXISTS safe_tx_data JSONB;
  `);

    logger.info('Migration completed: 037_add_execution_paused_state');
};

export const down = async (pool: Pool): Promise<void> => {
    logger.info('Rolling back migration: 037_add_execution_paused_state');

    await pool.query(`
    ALTER TABLE workflow_executions
      DROP COLUMN IF EXISTS paused_at_node_id,
      DROP COLUMN IF EXISTS paused_context,
      DROP COLUMN IF EXISTS safe_tx_hash,
      DROP COLUMN IF EXISTS safe_tx_data;
  `);

    // Note: PostgreSQL does not support removing enum values easily.
    // WAITING_FOR_SIGNATURE will remain in the enum but be unused.

    logger.info('Rollback completed: 037_add_execution_paused_state');
};
