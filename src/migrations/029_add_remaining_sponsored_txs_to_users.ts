import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  logger.info('Running migration: 029_add_remaining_sponsored_txs_to_users');

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS remaining_sponsored_txs INTEGER NOT NULL DEFAULT 3;
  `);

  logger.info('Migration completed: 029_add_remaining_sponsored_txs_to_users');
};

export const down = async (pool: Pool): Promise<void> => {
  logger.info('Rolling back migration: 029_add_remaining_sponsored_txs_to_users');

  await pool.query(`
    ALTER TABLE users DROP COLUMN IF EXISTS remaining_sponsored_txs;
  `);

  logger.info('Rollback completed: 029_add_remaining_sponsored_txs_to_users');
};
