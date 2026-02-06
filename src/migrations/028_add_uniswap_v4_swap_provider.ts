import { Pool } from 'pg';
import { logger } from '../utils/logger';

/**
 * Migration: Add UNISWAP_V4 to swap_executions valid_provider constraint
 */
export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    logger.info('Adding UNISWAP_V4 to swap_executions valid_provider constraint...');

    await client.query(`
      ALTER TABLE swap_executions
      DROP CONSTRAINT IF EXISTS valid_provider;
    `);

    await client.query(`
      ALTER TABLE swap_executions
      ADD CONSTRAINT valid_provider
      CHECK (provider IN ('UNISWAP', 'UNISWAP_V4', 'RELAY', 'ONEINCH', 'LIFI'));
    `);

    await client.query('COMMIT');
    logger.info('UNISWAP_V4 added to swap_executions valid_provider constraint');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to add UNISWAP_V4 swap provider constraint');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT COUNT(*) as count FROM swap_executions WHERE provider = 'UNISWAP_V4'`
    );

    if (parseInt(existing.rows[0].count, 10) > 0) {
      throw new Error(
        'Cannot rollback: swap_executions contains UNISWAP_V4 rows. Delete them first.'
      );
    }

    await client.query(`
      ALTER TABLE swap_executions
      DROP CONSTRAINT IF EXISTS valid_provider;
    `);

    await client.query(`
      ALTER TABLE swap_executions
      ADD CONSTRAINT valid_provider
      CHECK (provider IN ('UNISWAP', 'RELAY', 'ONEINCH', 'LIFI'));
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to rollback UNISWAP_V4 swap provider constraint');
    throw error;
  } finally {
    client.release();
  }
};
