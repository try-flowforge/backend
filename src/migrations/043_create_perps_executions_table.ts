import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    logger.info('Running migration: 043_create_perps_executions_table');

    await client.query(`
      CREATE TABLE IF NOT EXISTS perps_executions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        node_execution_id UUID NOT NULL REFERENCES node_executions(id) ON DELETE CASCADE,
        workflow_execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        network VARCHAR(16) NOT NULL CHECK (network IN ('testnet', 'mainnet')),
        action VARCHAR(64) NOT NULL,
        status VARCHAR(64) NOT NULL,

        request_payload JSONB,
        response_payload JSONB,
        tx_hash VARCHAR(66),
        error_code VARCHAR(128),
        error_message TEXT,

        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_perps_executions_node_execution_id
      ON perps_executions(node_execution_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_perps_executions_workflow_execution_id
      ON perps_executions(workflow_execution_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_perps_executions_user_id_created_at
      ON perps_executions(user_id, created_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_perps_executions_status
      ON perps_executions(status);
    `);

    await client.query('COMMIT');
    logger.info('Migration completed: 043_create_perps_executions_table');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed migration: 043_create_perps_executions_table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    logger.info('Rolling back migration: 043_create_perps_executions_table');

    await client.query('DROP INDEX IF EXISTS idx_perps_executions_status;');
    await client.query('DROP INDEX IF EXISTS idx_perps_executions_user_id_created_at;');
    await client.query('DROP INDEX IF EXISTS idx_perps_executions_workflow_execution_id;');
    await client.query('DROP INDEX IF EXISTS idx_perps_executions_node_execution_id;');
    await client.query('DROP TABLE IF EXISTS perps_executions;');

    await client.query('COMMIT');
    logger.info('Rollback completed: 043_create_perps_executions_table');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed rollback: 043_create_perps_executions_table');
    throw error;
  } finally {
    client.release();
  }
};
