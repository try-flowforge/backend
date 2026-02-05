import { Pool } from 'pg';
import { logger } from '../utils/logger';

/**
 * Migration: Add LIFI to swap_executions valid_provider constraint
 *
 * swap_executions.provider is constrained via CHECK (valid_provider).
 * When we added the LI.FI swap provider, inserts started failing with:
 *   violates check constraint "valid_provider"
 */
export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    logger.info('Adding LIFI to swap_executions valid_provider constraint...');

    // Drop and recreate constraint (idempotent)
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
    logger.info('LIFI added to swap_executions valid_provider constraint');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to add LIFI swap provider constraint');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    logger.info('Removing LIFI from swap_executions valid_provider constraint...');

    // Ensure there are no LIFI rows before rollback
    const existing = await client.query(
      `SELECT COUNT(*) as count FROM swap_executions WHERE provider = 'LIFI'`
    );

    if (parseInt(existing.rows[0].count, 10) > 0) {
      throw new Error(
        'Cannot rollback: swap_executions contains LIFI rows. Delete them first.'
      );
    }

    await client.query(`
      ALTER TABLE swap_executions
      DROP CONSTRAINT IF EXISTS valid_provider;
    `);

    await client.query(`
      ALTER TABLE swap_executions
      ADD CONSTRAINT valid_provider
      CHECK (provider IN ('UNISWAP', 'RELAY', 'ONEINCH'));
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to rollback LIFI swap provider constraint');
    throw error;
  } finally {
    client.release();
  }
};

