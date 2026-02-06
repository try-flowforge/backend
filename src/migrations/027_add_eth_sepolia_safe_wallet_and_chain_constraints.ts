import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  logger.info('Running migration: 027_add_eth_sepolia_safe_wallet_and_chain_constraints');

  // 1. Add safe_wallet_address_eth_sepolia column for Ethereum Sepolia
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS safe_wallet_address_eth_sepolia VARCHAR(42);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_safe_wallet_eth_sepolia
    ON users(safe_wallet_address_eth_sepolia)
    WHERE safe_wallet_address_eth_sepolia IS NOT NULL;
  `);

  // 2. swap_executions: allow ETHEREUM_SEPOLIA
  await pool.query(`
    ALTER TABLE swap_executions
    DROP CONSTRAINT IF EXISTS valid_chain;
  `);
  await pool.query(`
    ALTER TABLE swap_executions
    ADD CONSTRAINT valid_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA', 'ETHEREUM_SEPOLIA'));
  `);

  // 3. lending_executions: allow ETHEREUM_SEPOLIA
  await pool.query(`
    ALTER TABLE lending_executions
    DROP CONSTRAINT IF EXISTS valid_lending_chain;
  `);
  await pool.query(`
    ALTER TABLE lending_executions
    ADD CONSTRAINT valid_lending_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA', 'ETHEREUM_SEPOLIA'));
  `);

  // 4. managed_wallets: align chain with enum; migrate legacy 'SEPOLIA' to 'ARBITRUM_SEPOLIA'
  await pool.query(`
    UPDATE managed_wallets SET chain = 'ARBITRUM_SEPOLIA' WHERE chain = 'SEPOLIA';
  `);
  await pool.query(`
    ALTER TABLE managed_wallets
    DROP CONSTRAINT IF EXISTS valid_chain;
  `);
  await pool.query(`
    ALTER TABLE managed_wallets
    ADD CONSTRAINT valid_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA', 'ETHEREUM_SEPOLIA'));
  `);

  logger.info('Migration completed: 027_add_eth_sepolia_safe_wallet_and_chain_constraints');
};

export const down = async (pool: Pool): Promise<void> => {
  logger.info('Rolling back migration: 027_add_eth_sepolia_safe_wallet_and_chain_constraints');

  await pool.query(`DROP INDEX IF EXISTS idx_users_safe_wallet_eth_sepolia;`);
  await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS safe_wallet_address_eth_sepolia;`);

  await pool.query(`ALTER TABLE swap_executions DROP CONSTRAINT IF EXISTS valid_chain;`);
  await pool.query(`
    ALTER TABLE swap_executions
    ADD CONSTRAINT valid_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA'));
  `);

  await pool.query(`ALTER TABLE lending_executions DROP CONSTRAINT IF EXISTS valid_lending_chain;`);
  await pool.query(`
    ALTER TABLE lending_executions
    ADD CONSTRAINT valid_lending_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA'));
  `);

  await pool.query(`ALTER TABLE managed_wallets DROP CONSTRAINT IF EXISTS valid_chain;`);
  await pool.query(`
    ALTER TABLE managed_wallets
    ADD CONSTRAINT valid_chain CHECK (chain IN ('ARBITRUM', 'SEPOLIA'));
  `);

  logger.info('Rollback completed: 027_add_eth_sepolia_safe_wallet_and_chain_constraints');
};
