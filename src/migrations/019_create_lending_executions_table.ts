import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Creating lending_executions table...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS lending_executions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        node_execution_id UUID NOT NULL REFERENCES node_executions(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL,
        chain VARCHAR(50) NOT NULL,
        wallet_address VARCHAR(255) NOT NULL,
        operation VARCHAR(50) NOT NULL,
        asset JSONB NOT NULL, -- {address, symbol, decimals, name}
        amount VARCHAR(255) NOT NULL, -- Wei/smallest unit as string
        interest_rate_mode VARCHAR(50), -- STABLE or VARIABLE (for borrow/repay)
        tx_hash VARCHAR(255),
        gas_used VARCHAR(255),
        effective_gas_price VARCHAR(255),
        block_number INTEGER,
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        error_message TEXT,
        error_code VARCHAR(100),
        position_data JSONB, -- Post-execution position details
        quote_data JSONB, -- Full quote details from provider
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE,
        CONSTRAINT valid_lending_provider CHECK (provider IN ('AAVE', 'COMPOUND')),
        CONSTRAINT valid_lending_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA')),
        CONSTRAINT valid_lending_operation CHECK (operation IN ('SUPPLY', 'WITHDRAW', 'BORROW', 'REPAY', 'ENABLE_COLLATERAL', 'DISABLE_COLLATERAL')),
        CONSTRAINT valid_interest_rate_mode CHECK (interest_rate_mode IS NULL OR interest_rate_mode IN ('STABLE', 'VARIABLE')),
        CONSTRAINT valid_lending_status CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'RETRYING'))
      );
    `);
    
    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lending_executions_node_execution_id ON lending_executions(node_execution_id);
      CREATE INDEX IF NOT EXISTS idx_lending_executions_wallet_address ON lending_executions(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_lending_executions_tx_hash ON lending_executions(tx_hash);
      CREATE INDEX IF NOT EXISTS idx_lending_executions_status ON lending_executions(status);
      CREATE INDEX IF NOT EXISTS idx_lending_executions_provider_chain ON lending_executions(provider, chain);
      CREATE INDEX IF NOT EXISTS idx_lending_executions_operation ON lending_executions(operation);
      CREATE INDEX IF NOT EXISTS idx_lending_executions_created_at ON lending_executions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lending_executions_wallet_operation ON lending_executions(wallet_address, operation);
    `);
    
    logger.info('lending_executions table created successfully');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to create lending_executions table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Dropping lending_executions table...');
    await client.query('DROP TABLE IF EXISTS lending_executions CASCADE;');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to drop lending_executions table');
    throw error;
  } finally {
    client.release();
  }
};

