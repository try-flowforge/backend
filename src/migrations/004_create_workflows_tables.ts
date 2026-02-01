import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Creating workflows table...');
    
    // Main workflows table
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        trigger_node_id UUID,
        is_active BOOLEAN NOT NULL DEFAULT false,
        is_draft BOOLEAN NOT NULL DEFAULT true,
        max_concurrent_executions INTEGER DEFAULT 1,
        timeout INTEGER, -- milliseconds
        tags TEXT[],
        category VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        last_executed_at TIMESTAMP WITH TIME ZONE,
        CONSTRAINT max_concurrent_executions_positive CHECK (max_concurrent_executions > 0),
        CONSTRAINT timeout_positive CHECK (timeout IS NULL OR timeout > 0)
      );
    `);
    
    // Create indexes for workflows
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON workflows(user_id);
      CREATE INDEX IF NOT EXISTS idx_workflows_is_active ON workflows(is_active);
      CREATE INDEX IF NOT EXISTS idx_workflows_category ON workflows(category);
      CREATE INDEX IF NOT EXISTS idx_workflows_last_executed_at ON workflows(last_executed_at);
    `);
    
    logger.info('Workflows table created successfully');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to create workflows table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Dropping workflows table...');
    await client.query('DROP TABLE IF EXISTS workflows CASCADE;');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to drop workflows table');
    throw error;
  } finally {
    client.release();
  }
};

