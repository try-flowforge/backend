import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    logger.info('Creating time_blocks table...');

    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'time_blocks'
      );
    `);

    if (!tableExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE time_blocks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          run_at TIMESTAMP WITH TIME ZONE NOT NULL,
          timezone VARCHAR(64),
          recurrence_type VARCHAR(20) NOT NULL DEFAULT 'NONE',
          interval_seconds INTEGER,
          cron_expression TEXT,
          until_at TIMESTAMP WITH TIME ZONE,
          max_runs INTEGER,
          run_count INTEGER NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          cancelled_at TIMESTAMP WITH TIME ZONE,
          completed_at TIMESTAMP WITH TIME ZONE,
          CONSTRAINT valid_time_block_status CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED')),
          CONSTRAINT valid_recurrence_type CHECK (recurrence_type IN ('NONE', 'INTERVAL', 'CRON')),
          CONSTRAINT interval_requires_seconds CHECK (
            (recurrence_type <> 'INTERVAL') OR (interval_seconds IS NOT NULL AND interval_seconds > 0)
          ),
          CONSTRAINT cron_requires_expression CHECK (
            (recurrence_type <> 'CRON') OR (cron_expression IS NOT NULL AND length(cron_expression) > 0)
          )
        );
      `);

      logger.info('time_blocks table created');
    } else {
      logger.info('time_blocks table already exists, skipping creation');
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_time_blocks_user_id ON time_blocks(user_id);
      CREATE INDEX IF NOT EXISTS idx_time_blocks_workflow_id ON time_blocks(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_time_blocks_status ON time_blocks(status);
      CREATE INDEX IF NOT EXISTS idx_time_blocks_run_at ON time_blocks(run_at);
      CREATE INDEX IF NOT EXISTS idx_time_blocks_composite ON time_blocks(user_id, status, run_at);
    `);

    await client.query('COMMIT');
    logger.info('time_blocks table setup completed');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to create time_blocks table');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    logger.info('Dropping time_blocks table...');
    await client.query('DROP TABLE IF EXISTS time_blocks CASCADE;');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to drop time_blocks table');
    throw error;
  } finally {
    client.release();
  }
};

