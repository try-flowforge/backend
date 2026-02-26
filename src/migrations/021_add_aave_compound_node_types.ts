import { Pool } from 'pg';
import { logger } from '../utils/logger';

/**
 * Migration: Add AAVE, COMPOUND, CHAINLINK_PRICE_ORACLE, and PYTH_PRICE_ORACLE node types to constraints
 * 
 * This migration updates the valid_node_type constraint to include AAVE, COMPOUND,
 * CHAINLINK_PRICE_ORACLE, and PYTH_PRICE_ORACLE as valid node types for the workflow_nodes and node_executions tables.
 */

// All valid node types - must match the NodeType enum in the application
const ALL_NODE_TYPES = [
    'TRIGGER',
    'START',
    'SWAP',
    'CHAINLINK_PRICE_ORACLE',
    'PYTH_PRICE_ORACLE',
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
];

const NODE_TYPES_SQL = ALL_NODE_TYPES.map(t => `'${t}'`).join(', ');

export const up = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');


        // Drop and recreate constraints (idempotent approach)
        // Drop the old constraint on workflow_nodes
        await client.query(`
      ALTER TABLE workflow_nodes 
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

        // Add new constraint with ALL node types including AAVE, COMPOUND, CHAINLINK_PRICE_ORACLE, and PYTH_PRICE_ORACLE
        await client.query(`
      ALTER TABLE workflow_nodes
      ADD CONSTRAINT valid_node_type 
      CHECK (type IN (${NODE_TYPES_SQL}));
    `);

        // Drop the old constraint on node_executions
        await client.query(`
      ALTER TABLE node_executions 
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

        // Add new constraint with ALL node types including AAVE, COMPOUND, CHAINLINK_PRICE_ORACLE, and PYTH_PRICE_ORACLE
        await client.query(`
      ALTER TABLE node_executions
      ADD CONSTRAINT valid_node_type 
      CHECK (node_type IN (${NODE_TYPES_SQL}));
    `);


        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Failed to add AAVE, COMPOUND, CHAINLINK_PRICE_ORACLE, and PYTH_PRICE_ORACLE node types');
        throw error;
    } finally {
        client.release();
    }
};

export const down = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    // Node types without AAVE, COMPOUND, CHAINLINK_PRICE_ORACLE, and PYTH_PRICE_ORACLE for rollback
    const NODE_TYPES_WITHOUT_NEW = ALL_NODE_TYPES.filter(t => t !== 'AAVE' && t !== 'COMPOUND' && t !== 'CHAINLINK_PRICE_ORACLE' && t !== 'PYTH_PRICE_ORACLE');
    const NODE_TYPES_SQL_OLD = NODE_TYPES_WITHOUT_NEW.map(t => `'${t}'`).join(', ');

    try {
        await client.query('BEGIN');


        // First, check if any AAVE, COMPOUND, CHAINLINK_PRICE_ORACLE, or PYTH_PRICE_ORACLE nodes exist
        const existingNodes = await client.query(`
      SELECT COUNT(*) as count FROM workflow_nodes WHERE type IN ('AAVE', 'COMPOUND', 'CHAINLINK_PRICE_ORACLE', 'PYTH_PRICE_ORACLE')
    `);

        if (parseInt(existingNodes.rows[0].count) > 0) {
            throw new Error('Cannot rollback: AAVE, COMPOUND, CHAINLINK_PRICE_ORACLE, or PYTH_PRICE_ORACLE nodes exist in the database. Delete them first.');
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
        logger.error({ error }, 'Failed to remove AAVE, COMPOUND, CHAINLINK_PRICE_ORACLE, and PYTH_PRICE_ORACLE node types');
        throw error;
    } finally {
        client.release();
    }
};
