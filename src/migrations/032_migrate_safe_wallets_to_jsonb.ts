import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
    logger.info('Running migration: 032_migrate_safe_wallets_to_jsonb');

    // 1. Add new JSONB column
    await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS safe_wallets JSONB DEFAULT '{}'::jsonb;
  `);

    // 2. Migrate existing data
    // 42161 = Arbitrum Mainnet, 421614 = Arbitrum Sepolia, 11155111 = Ethereum Sepolia
    await pool.query(`
    UPDATE users
    SET safe_wallets = jsonb_strip_nulls(jsonb_build_object(
      '42161', safe_wallet_address_mainnet,
      '421614', safe_wallet_address_testnet,
      '11155111', safe_wallet_address_eth_sepolia
    ));
  `);

    // 3. Drop old columns (optional but cleaner)
    await pool.query(`
    ALTER TABLE users
    DROP COLUMN IF EXISTS safe_wallet_address_mainnet,
    DROP COLUMN IF EXISTS safe_wallet_address_testnet,
    DROP COLUMN IF EXISTS safe_wallet_address_eth_sepolia;
  `);

    logger.info('Migration completed: 032_migrate_safe_wallets_to_jsonb');
};

export const down = async (pool: Pool): Promise<void> => {
    logger.info('Rolling back migration: 032_migrate_safe_wallets_to_jsonb');

    // 1. Restore old columns
    await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS safe_wallet_address_mainnet VARCHAR(255),
    ADD COLUMN IF NOT EXISTS safe_wallet_address_testnet VARCHAR(255),
    ADD COLUMN IF NOT EXISTS safe_wallet_address_eth_sepolia VARCHAR(255);
  `);

    // 2. Restore data from JSONB
    await pool.query(`
    UPDATE users
    SET 
      safe_wallet_address_mainnet = safe_wallets->>'42161',
      safe_wallet_address_testnet = safe_wallets->>'421614',
      safe_wallet_address_eth_sepolia = safe_wallets->>'11155111';
  `);

    // 3. Drop JSONB column
    await pool.query(`
    ALTER TABLE users
    DROP COLUMN IF EXISTS safe_wallets;
  `);

    logger.info('Rollback completed: 032_migrate_safe_wallets_to_jsonb');
};
