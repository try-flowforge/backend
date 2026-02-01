import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Creating workflow_executions table...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_executions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        triggered_by VARCHAR(50) NOT NULL,
        triggered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        initial_input JSONB, -- Initial data from trigger
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        error JSONB, -- Error details {message, code, nodeId, stack}
        started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE,
        retry_count INTEGER NOT NULL DEFAULT 0,
        metadata JSONB, -- Additional execution metadata
        CONSTRAINT valid_triggered_by CHECK (triggered_by IN ('CRON', 'WEBHOOK', 'MANUAL', 'EVENT')),
        CONSTRAINT valid_status CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'RETRYING'))
      );
    `);
    
    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON workflow_executions(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_id ON workflow_executions(user_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_started_at ON workflow_executions(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_composite ON workflow_executions(workflow_id, status, started_at DESC);
    `);
    
    logger.info('workflow_executions table created successfully');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to create workflow_executions table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Dropping workflow_executions table...');
    await client.query('DROP TABLE IF EXISTS workflow_executions CASCADE;');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to drop workflow_executions table');
    throw error;
  } finally {
    client.release();
  }
};

