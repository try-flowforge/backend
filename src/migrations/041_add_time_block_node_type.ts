
import { Pool } from 'pg';
import { logger } from '../utils/logger';

/**
 * Migration: Add TIME_BLOCK node type to constraints
 *
 * This migration updates the valid_node_type constraint to include:
 * - TIME_BLOCK (schedule workflow execution)
 */

// All valid node types from 035 + TIME_BLOCK
const ALL_NODE_TYPES = [
  'TRIGGER',
  'START',
  'SWAP',
  'CHAINLINK_PRICE_ORACLE',
  'PYTH_PRICE_ORACLE',
  'PRICE_ORACLE',
  'IF',
  'SWITCH',
  'LENDING',
  'AAVE',
  'COMPOUND',
  'CONDITION',
  'WEBHOOK',
  'DELAY',
  'EMAIL',
  'SLACK',
  'TELEGRAM',
  'WALLET',
  'LLM_TRANSFORM',
  'LIFI',
  'API',
  'TIME_BLOCK', // New
];

const NODE_TYPES_SQL = ALL_NODE_TYPES.map((t) => `'${t}'`).join(', ');

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');


    await client.query(`
      ALTER TABLE workflow_nodes
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

    await client.query(`
      ALTER TABLE workflow_nodes
      ADD CONSTRAINT valid_node_type
      CHECK (type IN (${NODE_TYPES_SQL}));
    `);

    await client.query(`
      ALTER TABLE node_executions
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

    await client.query(`
      ALTER TABLE node_executions
      ADD CONSTRAINT valid_node_type
      CHECK (node_type IN (${NODE_TYPES_SQL}));
    `);


    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to add TIME_BLOCK node type');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  const NODE_TYPES_WITHOUT_TIME_BLOCK = ALL_NODE_TYPES.filter((t) => t !== 'TIME_BLOCK');
  const NODE_TYPES_SQL_OLD = NODE_TYPES_WITHOUT_TIME_BLOCK.map((t) => `'${t}'`).join(', ');

  try {
    await client.query('BEGIN');


    const existingNodes = await client.query(`
      SELECT COUNT(*) as count FROM workflow_nodes WHERE type = 'TIME_BLOCK'
    `);

    if (parseInt(existingNodes.rows[0].count, 10) > 0) {
      throw new Error(
        'Cannot rollback: TIME_BLOCK nodes exist in the database. Delete them first.'
      );
    }

    await client.query(`
      ALTER TABLE workflow_nodes
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

    await client.query(`
      ALTER TABLE workflow_nodes
      ADD CONSTRAINT valid_node_type
      CHECK (type IN (${NODE_TYPES_SQL_OLD}));
    `);

    await client.query(`
      ALTER TABLE node_executions
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

    await client.query(`
      ALTER TABLE node_executions
      ADD CONSTRAINT valid_node_type
      CHECK (node_type IN (${NODE_TYPES_SQL_OLD}));
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to remove TIME_BLOCK node type');
    throw error;
  } finally {
    client.release();
  }
};
