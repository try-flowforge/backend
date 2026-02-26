import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');


    await client.query(`
      CREATE TABLE IF NOT EXISTS ostium_delegations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        network VARCHAR(16) NOT NULL CHECK (network IN ('testnet', 'mainnet')),
        chain_id INTEGER NOT NULL,
        safe_address VARCHAR(42) NOT NULL,
        delegate_address VARCHAR(42) NOT NULL,
        trading_contract VARCHAR(42) NOT NULL,

        status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED', 'FAILED')),
        approval_tx_hash VARCHAR(66),
        revoke_tx_hash VARCHAR(66),
        safe_tx_hash VARCHAR(66),
        safe_tx_data JSONB,
        last_error TEXT,

        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

        UNIQUE (user_id, network, delegate_address)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ostium_delegations_user_network
      ON ostium_delegations(user_id, network);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ostium_delegations_status
      ON ostium_delegations(status);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ostium_delegations_safe_address
      ON ostium_delegations(safe_address);
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed migration: 042_create_ostium_delegations_table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');


    await client.query('DROP INDEX IF EXISTS idx_ostium_delegations_safe_address;');
    await client.query('DROP INDEX IF EXISTS idx_ostium_delegations_status;');
    await client.query('DROP INDEX IF EXISTS idx_ostium_delegations_user_network;');
    await client.query('DROP TABLE IF EXISTS ostium_delegations;');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed rollback: 042_create_ostium_delegations_table');
    throw error;
  } finally {
    client.release();
  }
};
