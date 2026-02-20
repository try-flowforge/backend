import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
    logger.info('Running migration: 038_add_safe_tx_to_intents');

    await pool.query(`
    ALTER TABLE transaction_intents
      ADD COLUMN IF NOT EXISTS safe_tx_hash TEXT,
      ADD COLUMN IF NOT EXISTS safe_tx_data  JSONB;
  `);

    logger.info('Migration completed: 038_add_safe_tx_to_intents');
};

export const down = async (pool: Pool): Promise<void> => {
    logger.info('Rolling back migration: 038_add_safe_tx_to_intents');

    await pool.query(`
    ALTER TABLE transaction_intents
      DROP COLUMN IF EXISTS safe_tx_hash,
      DROP COLUMN IF EXISTS safe_tx_data;
  `);

    logger.info('Rollback completed: 038_add_safe_tx_to_intents');
};
