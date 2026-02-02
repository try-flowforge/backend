import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  logger.info('Running migration: 015_add_safe_wallet_to_users');

  // Add safe_wallet_address_testnet column for Arbitrum Sepolia
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS safe_wallet_address_testnet VARCHAR(42);
  `);

  // Add safe_wallet_address_mainnet column for Arbitrum Mainnet
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS safe_wallet_address_mainnet VARCHAR(42);
  `);

  // Create unique indexes for both columns
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_safe_wallet_testnet 
    ON users(safe_wallet_address_testnet) 
    WHERE safe_wallet_address_testnet IS NOT NULL;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_safe_wallet_mainnet 
    ON users(safe_wallet_address_mainnet) 
    WHERE safe_wallet_address_mainnet IS NOT NULL;
  `);

  logger.info('Migration completed: 015_add_safe_wallet_to_users');
};

export const down = async (pool: Pool): Promise<void> => {
  logger.info('Rolling back migration: 015_add_safe_wallet_to_users');

  await pool.query(`DROP INDEX IF EXISTS idx_users_safe_wallet_mainnet;`);
  await pool.query(`DROP INDEX IF EXISTS idx_users_safe_wallet_testnet;`);
  await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS safe_wallet_address_mainnet;`);
  await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS safe_wallet_address_testnet;`);

  logger.info('Rollback completed: 015_add_safe_wallet_to_users');
};
