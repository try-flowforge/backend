import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        logger.info('Updating swap_executions table constraints to remove RELAY and ONEINCH...');

        await client.query(`
      ALTER TABLE swap_executions 
      DROP CONSTRAINT valid_provider;
    `);

        await client.query(`
      ALTER TABLE swap_executions 
      ADD CONSTRAINT valid_provider 
      CHECK (provider IN ('UNISWAP', 'UNISWAP_V4', 'LIFI'));
    `);

        logger.info('swap_executions constraints updated successfully');

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Failed to update swap_executions constraints');
        throw error;
    } finally {
        client.release();
    }
};

export const down = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        logger.info('Reverting swap_executions table constraints...');

        await client.query(`
      ALTER TABLE swap_executions 
      DROP CONSTRAINT valid_provider;
    `);

        await client.query(`
      ALTER TABLE swap_executions 
      ADD CONSTRAINT valid_provider 
      CHECK (provider IN ('UNISWAP', 'UNISWAP_V4', 'RELAY', 'ONEINCH', 'LIFI'));
    `);

        logger.info('swap_executions constraints reverted successfully');

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Failed to revert swap_executions constraints');
        throw error;
    } finally {
        client.release();
    }
};
