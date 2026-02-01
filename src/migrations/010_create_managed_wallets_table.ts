import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Creating managed_wallets table...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS managed_wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        address VARCHAR(255) NOT NULL,
        encrypted_private_key TEXT NOT NULL, -- Encrypted with KMS/vault
        chain VARCHAR(50) NOT NULL,
        label VARCHAR(255),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT valid_chain CHECK (chain IN ('ARBITRUM', 'SEPOLIA')),
        CONSTRAINT unique_user_address_chain UNIQUE (user_id, address, chain)
      );
    `);
    
    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_managed_wallets_user_id ON managed_wallets(user_id);
      CREATE INDEX IF NOT EXISTS idx_managed_wallets_address ON managed_wallets(address);
      CREATE INDEX IF NOT EXISTS idx_managed_wallets_chain ON managed_wallets(chain);
      CREATE INDEX IF NOT EXISTS idx_managed_wallets_is_active ON managed_wallets(is_active);
    `);
    
    logger.info('managed_wallets table created successfully');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to create managed_wallets table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Dropping managed_wallets table...');
    await client.query('DROP TABLE IF EXISTS managed_wallets CASCADE;');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to drop managed_wallets table');
    throw error;
  } finally {
    client.release();
  }
};

