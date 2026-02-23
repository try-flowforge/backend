import { Pool } from 'pg';
import { logger } from '../utils/logger';

const NEW_STATUS_VALUES = "'PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'RETRYING', 'WAITING_FOR_SIGNATURE', 'WAITING_FOR_CLIENT_TX'";
const OLD_STATUS_VALUES = "'PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'RETRYING', 'WAITING_FOR_SIGNATURE'";

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    logger.info('Running migration: 045_add_waiting_for_client_tx_status');

    for (const table of ['workflow_executions', 'node_executions', 'swap_executions']) {
      await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS valid_status`);
      await client.query(`ALTER TABLE ${table} ADD CONSTRAINT valid_status CHECK (status IN (${NEW_STATUS_VALUES}))`);
    }
    await client.query('ALTER TABLE lending_executions DROP CONSTRAINT IF EXISTS valid_lending_status');
    await client.query(`ALTER TABLE lending_executions ADD CONSTRAINT valid_lending_status CHECK (status IN (${NEW_STATUS_VALUES}))`);

    await client.query('COMMIT');
    logger.info('Migration completed: 045_add_waiting_for_client_tx_status');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Migration failed: 045_add_waiting_for_client_tx_status');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    logger.info('Rolling back migration: 045_add_waiting_for_client_tx_status');

    for (const table of ['workflow_executions', 'node_executions', 'swap_executions']) {
      await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS valid_status`);
      await client.query(`ALTER TABLE ${table} ADD CONSTRAINT valid_status CHECK (status IN (${OLD_STATUS_VALUES}))`);
    }
    await client.query('ALTER TABLE lending_executions DROP CONSTRAINT IF EXISTS valid_lending_status');
    await client.query(`ALTER TABLE lending_executions ADD CONSTRAINT valid_lending_status CHECK (status IN (${OLD_STATUS_VALUES}))`);

    await client.query('COMMIT');
    logger.info('Rollback completed: 045_add_waiting_for_client_tx_status');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Rollback failed: 045_add_waiting_for_client_tx_status');
    throw error;
  } finally {
    client.release();
  }
};
