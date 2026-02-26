import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'node_executions'
      );
    `);

    if (!tableExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE node_executions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
          node_id UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
          node_type VARCHAR(50) NOT NULL,
          input_data JSONB,
          output_data JSONB,
          status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
          error JSONB, -- Error details {message, code, details}
          started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE,
          duration_ms INTEGER,
          retry_count INTEGER NOT NULL DEFAULT 0,
          CONSTRAINT valid_node_type CHECK (node_type IN ('TRIGGER', 'SWAP', 'CONDITION', 'WEBHOOK', 'DELAY')),
          CONSTRAINT valid_status CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'RETRYING'))
        );
      `);
    } else {
    }

    // Create indexes (idempotent)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_node_executions_execution_id ON node_executions(execution_id);
      CREATE INDEX IF NOT EXISTS idx_node_executions_node_id ON node_executions(node_id);
      CREATE INDEX IF NOT EXISTS idx_node_executions_status ON node_executions(status);
      CREATE INDEX IF NOT EXISTS idx_node_executions_started_at ON node_executions(started_at DESC);
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to create node_executions table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DROP TABLE IF EXISTS node_executions CASCADE;');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to drop node_executions table');
    throw error;
  } finally {
    client.release();
  }
};
