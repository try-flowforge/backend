import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS spending_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        network VARCHAR(16) NOT NULL CHECK (network IN ('testnet', 'mainnet')),
        chain_id INTEGER NOT NULL,
        safe_address VARCHAR(42) NOT NULL,
        spend_limit_usd NUMERIC(20,2) NOT NULL DEFAULT 0,
        daily_limit_usd NUMERIC(20,2) NOT NULL DEFAULT 0,
        deadline TIMESTAMP WITH TIME ZONE NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        policy_tx_hash VARCHAR(66),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, network, safe_address, chain_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS spending_ledger (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        policy_id UUID REFERENCES spending_policies(id) ON DELETE CASCADE,
        execution_id UUID,
        amount_usd NUMERIC(20,2) NOT NULL,
        tx_hash VARCHAR(66),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_spending_policies_user_network_chain
      ON spending_policies(user_id, network, chain_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_spending_policies_safe_address
      ON spending_policies(safe_address);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_spending_ledger_policy_created_at
      ON spending_ledger(policy_id, created_at);
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed migration: 052_create_spending_policies_tables');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query('DROP INDEX IF EXISTS idx_spending_ledger_policy_created_at;');
    await client.query('DROP INDEX IF EXISTS idx_spending_policies_safe_address;');
    await client.query('DROP INDEX IF EXISTS idx_spending_policies_user_network_chain;');
    await client.query('DROP TABLE IF EXISTS spending_ledger;');
    await client.query('DROP TABLE IF EXISTS spending_policies;');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed rollback: 052_create_spending_policies_tables');
    throw error;
  } finally {
    client.release();
  }
};
