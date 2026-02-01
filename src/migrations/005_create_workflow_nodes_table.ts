import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Creating workflow_nodes table...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_nodes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        config JSONB NOT NULL DEFAULT '{}',
        position JSONB, -- {x, y} coordinates for UI
        metadata JSONB, -- version, category, tags, etc.
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT valid_node_type CHECK (type IN ('TRIGGER', 'SWAP', 'CONDITION', 'WEBHOOK', 'DELAY'))
      );
    `);
    
    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow_id ON workflow_nodes(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_nodes_type ON workflow_nodes(type);
    `);
    
    logger.info('workflow_nodes table created successfully');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to create workflow_nodes table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Dropping workflow_nodes table...');
    await client.query('DROP TABLE IF EXISTS workflow_nodes CASCADE;');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to drop workflow_nodes table');
    throw error;
  } finally {
    client.release();
  }
};

