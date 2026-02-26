import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        logger.info('Running migration: 051_make_perps_executions_ids_nullable');

        await client.query(`
      ALTER TABLE perps_executions 
      ALTER COLUMN node_execution_id DROP NOT NULL,
      ALTER COLUMN workflow_execution_id DROP NOT NULL;
    `);

        await client.query('COMMIT');
        logger.info('Migration completed: 051_make_perps_executions_ids_nullable');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Failed migration: 051_make_perps_executions_ids_nullable');
        throw error;
    } finally {
        client.release();
    }
};

export const down = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        logger.info('Rolling back migration: 051_make_perps_executions_ids_nullable');

        await client.query(`
      ALTER TABLE perps_executions 
      ALTER COLUMN node_execution_id SET NOT NULL,
      ALTER COLUMN workflow_execution_id SET NOT NULL;
    `);

        await client.query('COMMIT');
        logger.info('Rollback completed: 051_make_perps_executions_ids_nullable');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Failed rollback: 051_make_perps_executions_ids_nullable');
        throw error;
    } finally {
        client.release();
    }
};
