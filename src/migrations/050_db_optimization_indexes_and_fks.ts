import { Pool } from 'pg';
import { logger } from '../utils/logger';

/**
 * Migration 050: Database optimization
 * - Indexes for hot query paths (workflow executions, node executions, version history, transaction intents)
 * - Foreign keys for referential integrity (slack_connections.user_id, transaction_intents.user_id)
 */
export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    logger.info('Running migration: 050_db_optimization_indexes_and_fks');

    // 1. workflow_executions: (workflow_id, user_id, started_at DESC) for getExecutionHistory
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_user_started
      ON workflow_executions(workflow_id, user_id, started_at DESC);
    `);

    // 2. node_executions: (execution_id, node_id, started_at DESC) for node processor lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_node_executions_execution_node_started
      ON node_executions(execution_id, node_id, started_at DESC);
    `);

    // 3. workflow_version_history: (workflow_id, version_number DESC) for version list/fetch
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_version_history_workflow_version
      ON workflow_version_history(workflow_id, version_number DESC);
    `);

    // 4. transaction_intents: composite indexes for list/poll by user or agent
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transaction_intents_user_status
      ON transaction_intents(user_id, status);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transaction_intents_agent_user_status
      ON transaction_intents(agent_user_id, status);
    `);

    // 5. slack_connections: FK to users (referential integrity)
    const slackFkExists = await client.query(`
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'slack_connections' AND constraint_name = 'fk_slack_connections_user';
    `);
    if (slackFkExists.rows.length === 0) {
      await client.query(`
        ALTER TABLE slack_connections
        ADD CONSTRAINT fk_slack_connections_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
    }

    // 6. transaction_intents: FK user_id -> users (referential integrity)
    const intentUserFkExists = await client.query(`
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'transaction_intents' AND constraint_name = 'fk_transaction_intents_user';
    `);
    if (intentUserFkExists.rows.length === 0) {
      await client.query(`
        ALTER TABLE transaction_intents
        ADD CONSTRAINT fk_transaction_intents_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
    }

    await client.query('COMMIT');
    logger.info('Migration completed: 050_db_optimization_indexes_and_fks');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Migration failed: 050_db_optimization_indexes_and_fks');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    logger.info('Rolling back migration: 050_db_optimization_indexes_and_fks');

    await client.query(`ALTER TABLE transaction_intents DROP CONSTRAINT IF EXISTS fk_transaction_intents_user;`);
    await client.query(`ALTER TABLE slack_connections DROP CONSTRAINT IF EXISTS fk_slack_connections_user;`);

    await client.query(`DROP INDEX IF EXISTS idx_transaction_intents_agent_user_status;`);
    await client.query(`DROP INDEX IF EXISTS idx_transaction_intents_user_status;`);
    await client.query(`DROP INDEX IF EXISTS idx_workflow_version_history_workflow_version;`);
    await client.query(`DROP INDEX IF EXISTS idx_node_executions_execution_node_started;`);
    await client.query(`DROP INDEX IF EXISTS idx_workflow_executions_workflow_user_started;`);

    await client.query('COMMIT');
    logger.info('Rollback completed: 050_db_optimization_indexes_and_fks');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Rollback failed: 050_db_optimization_indexes_and_fks');
    throw error;
  } finally {
    client.release();
  }
};
