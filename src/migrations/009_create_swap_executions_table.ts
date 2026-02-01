import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Creating swap_executions table...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS swap_executions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        node_execution_id UUID NOT NULL REFERENCES node_executions(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL,
        chain VARCHAR(50) NOT NULL,
        wallet_address VARCHAR(255) NOT NULL,
        source_token JSONB NOT NULL, -- {address, symbol, decimals, name}
        destination_token JSONB NOT NULL, -- {address, symbol, decimals, name}
        amount_in VARCHAR(255) NOT NULL, -- Wei/smallest unit as string
        amount_out VARCHAR(255), -- Actual amount received
        tx_hash VARCHAR(255),
        gas_used VARCHAR(255),
        effective_gas_price VARCHAR(255),
        block_number INTEGER,
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        error_message TEXT,
        error_code VARCHAR(100),
        quote_data JSONB, -- Full quote details from provider
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE,
        CONSTRAINT valid_provider CHECK (provider IN ('UNISWAP', 'RELAY', 'ONEINCH')),
        CONSTRAINT valid_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA')),
        CONSTRAINT valid_status CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'RETRYING'))
      );
    `);
    
    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_swap_executions_node_execution_id ON swap_executions(node_execution_id);
      CREATE INDEX IF NOT EXISTS idx_swap_executions_wallet_address ON swap_executions(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_swap_executions_tx_hash ON swap_executions(tx_hash);
      CREATE INDEX IF NOT EXISTS idx_swap_executions_status ON swap_executions(status);
      CREATE INDEX IF NOT EXISTS idx_swap_executions_provider_chain ON swap_executions(provider, chain);
      CREATE INDEX IF NOT EXISTS idx_swap_executions_created_at ON swap_executions(created_at DESC);
    `);
    
    logger.info('swap_executions table created successfully');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to create swap_executions table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Dropping swap_executions table...');
    await client.query('DROP TABLE IF EXISTS swap_executions CASCADE;');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to drop swap_executions table');
    throw error;
  } finally {
    client.release();
  }
};

