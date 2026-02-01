import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Creating workflow_edges table...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_edges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        source_node_id UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
        target_node_id UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
        condition JSONB, -- conditional routing logic
        data_mapping JSONB, -- data transformation between nodes
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT no_self_loop CHECK (source_node_id != target_node_id)
      );
    `);
    
    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_edges_workflow_id ON workflow_edges(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_edges_source_node ON workflow_edges(source_node_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_edges_target_node ON workflow_edges(target_node_id);
    `);
    
    logger.info('workflow_edges table created successfully');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to create workflow_edges table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Dropping workflow_edges table...');
    await client.query('DROP TABLE IF EXISTS workflow_edges CASCADE;');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to drop workflow_edges table');
    throw error;
  } finally {
    client.release();
  }
};

