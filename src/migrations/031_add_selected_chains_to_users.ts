import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
    logger.info('Running migration: 031_add_selected_chains_to_users');

    await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS selected_chains TEXT[] DEFAULT NULL;
  `);

    logger.info('Migration completed: 031_add_selected_chains_to_users');
};

export const down = async (pool: Pool): Promise<void> => {
    logger.info('Rolling back migration: 031_add_selected_chains_to_users');

    await pool.query(`
    ALTER TABLE users DROP COLUMN IF EXISTS selected_chains;
  `);

    logger.info('Rollback completed: 031_add_selected_chains_to_users');
};
