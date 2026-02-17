
import { Pool } from 'pg';
import { logger } from '../utils/logger';

/**
 * Migration: Add PRICE_ORACLE and API node types to constraints
 * 
 * This migration updates the valid_node_type constraint to include:
 * - PRICE_ORACLE (Standardized Chainlink type)
 * - API (HTTP Request block)
 */

// All valid node types - must match the NodeType enum in the application
const ALL_NODE_TYPES = [
    'TRIGGER',
    'START',
    'SWAP',
    'CHAINLINK_PRICE_ORACLE',
    'PYTH_PRICE_ORACLE',
    'PRICE_ORACLE', // New
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
    'API', // New
];

const NODE_TYPES_SQL = ALL_NODE_TYPES.map(t => `'${t}'`).join(', ');

export const up = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        logger.info('Adding PRICE_ORACLE and API node types to constraints...');

        // Drop and recreate constraints on workflow_nodes
        await client.query(`
      ALTER TABLE workflow_nodes 
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

        await client.query(`
      ALTER TABLE workflow_nodes
      ADD CONSTRAINT valid_node_type 
      CHECK (type IN (${NODE_TYPES_SQL}));
    `);

        // Drop and recreate constraints on node_executions
        await client.query(`
      ALTER TABLE node_executions 
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

        await client.query(`
      ALTER TABLE node_executions
      ADD CONSTRAINT valid_node_type 
      CHECK (node_type IN (${NODE_TYPES_SQL}));
    `);

        logger.info('PRICE_ORACLE and API node types added to constraints successfully');

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Failed to add new node types');
        throw error;
    } finally {
        client.release();
    }
};

export const down = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    // Node types without new ones for rollback
    const NODE_TYPES_WITHOUT_NEW = ALL_NODE_TYPES.filter(t => t !== 'PRICE_ORACLE' && t !== 'API');
    const NODE_TYPES_SQL_OLD = NODE_TYPES_WITHOUT_NEW.map(t => `'${t}'`).join(', ');

    try {
        await client.query('BEGIN');

        logger.info('Removing PRICE_ORACLE and API node types from constraints...');

        // Check if any nodes exist with these types
        const existingNodes = await client.query(`
      SELECT COUNT(*) as count FROM workflow_nodes WHERE type IN ('PRICE_ORACLE', 'API')
    `);

        if (parseInt(existingNodes.rows[0].count) > 0) {
            throw new Error('Cannot rollback: PRICE_ORACLE or API nodes exist in the database. Delete them first.');
        }

        // Revert workflow_nodes constraint
        await client.query(`
      ALTER TABLE workflow_nodes 
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

        await client.query(`
      ALTER TABLE workflow_nodes
      ADD CONSTRAINT valid_node_type 
      CHECK (type IN (${NODE_TYPES_SQL_OLD}));
    `);

        // Revert node_executions constraint
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
        logger.error({ error }, 'Failed to remove node types');
        throw error;
    } finally {
        client.release();
    }
};
