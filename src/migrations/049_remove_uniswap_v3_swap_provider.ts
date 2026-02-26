import { Pool } from 'pg';
import { logger } from '../utils/logger';

export async function up(pool: Pool): Promise<void> {

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Remove the old constraint
        await client.query(`
      ALTER TABLE swap_executions 
      DROP CONSTRAINT IF EXISTS valid_provider;
    `);

        // Add the new constraint with only UNISWAP_V4 and LIFI
        await client.query(`
      ALTER TABLE swap_executions 
      ADD CONSTRAINT valid_provider 
      CHECK (provider IN ('UNISWAP_V4', 'LIFI'));
    `);

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Error in migration 048:');
        throw error;
    } finally {
        client.release();
    }
}

export async function down(pool: Pool): Promise<void> {

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Remove the current constraint
        await client.query(`
      ALTER TABLE swap_executions 
      DROP CONSTRAINT IF EXISTS valid_provider;
    `);

        // Add back UNISWAP to the constraints
        await client.query(`
      ALTER TABLE swap_executions 
      ADD CONSTRAINT valid_provider 
      CHECK (provider IN ('UNISWAP', 'UNISWAP_V4', 'LIFI'));
    `);

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Error reverting migration 048:');
        throw error;
    } finally {
        client.release();
    }
}
