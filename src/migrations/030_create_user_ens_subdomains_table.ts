import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  logger.info('Running migration: 030_create_user_ens_subdomains_table');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_ens_subdomains (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ens_name VARCHAR(255) NOT NULL,
      owner_address VARCHAR(42) NOT NULL,
      expiry TIMESTAMP WITH TIME ZONE NOT NULL,
      chain_id INTEGER NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(ens_name)
    );
    CREATE INDEX IF NOT EXISTS idx_user_ens_subdomains_user_id ON user_ens_subdomains(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_ens_subdomains_expiry ON user_ens_subdomains(expiry);
    CREATE INDEX IF NOT EXISTS idx_user_ens_subdomains_owner ON user_ens_subdomains(owner_address);
  `);

  logger.info('Migration completed: 030_create_user_ens_subdomains_table');
};

export const down = async (pool: Pool): Promise<void> => {
  logger.info('Rolling back migration: 030_create_user_ens_subdomains_table');

  await pool.query(`DROP TABLE IF EXISTS user_ens_subdomains;`);

  logger.info('Rollback completed: 030_create_user_ens_subdomains_table');
};
