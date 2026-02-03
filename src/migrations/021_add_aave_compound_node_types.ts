import { Pool } from 'pg';
import { logger } from '../utils/logger';

/**
 * Migration: Add AAVE and COMPOUND node types to constraints
 * 
 * This migration updates the valid_node_type constraint to include AAVE and COMPOUND
 * as valid node types for the workflow_nodes and node_executions tables.
 */

// All valid node types - must match the NodeType enum in the application
const ALL_NODE_TYPES = [
    'TRIGGER',
    'START',
    'SWAP',
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

        logger.info('Adding AAVE and COMPOUND node types to constraints...');

        // Drop and recreate constraints (idempotent approach)
        // Drop the old constraint on workflow_nodes
        await client.query(`
      ALTER TABLE workflow_nodes 
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

        // Add new constraint with ALL node types including AAVE and COMPOUND
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

        // Add new constraint with ALL node types including AAVE and COMPOUND
        await client.query(`
      ALTER TABLE node_executions
      ADD CONSTRAINT valid_node_type 
      CHECK (node_type IN (${NODE_TYPES_SQL}));
    `);

        logger.info('AAVE and COMPOUND node types added to constraints successfully');

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Failed to add AAVE and COMPOUND node types');
        throw error;
    } finally {
        client.release();
    }
};

export const down = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    // Node types without AAVE and COMPOUND for rollback
    const NODE_TYPES_WITHOUT_NEW = ALL_NODE_TYPES.filter(t => t !== 'AAVE' && t !== 'COMPOUND');
    const NODE_TYPES_SQL_OLD = NODE_TYPES_WITHOUT_NEW.map(t => `'${t}'`).join(', ');

    try {
        await client.query('BEGIN');

        logger.info('Removing AAVE and COMPOUND node types from constraints...');

        // First, check if any AAVE or COMPOUND nodes exist
        const existingNodes = await client.query(`
      SELECT COUNT(*) as count FROM workflow_nodes WHERE type IN ('AAVE', 'COMPOUND')
    `);

        if (parseInt(existingNodes.rows[0].count) > 0) {
            throw new Error('Cannot rollback: AAVE or COMPOUND nodes exist in the database. Delete them first.');
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
        logger.error({ error }, 'Failed to remove AAVE and COMPOUND node types');
        throw error;
    } finally {
        client.release();
    }
};
