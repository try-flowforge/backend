import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Adding LENDING node type to constraints...');
    
    // Drop the old constraint on workflow_nodes
    await client.query(`
      ALTER TABLE workflow_nodes 
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);
    
    // Add new constraint with LENDING included
    await client.query(`
      ALTER TABLE workflow_nodes
      ADD CONSTRAINT valid_node_type 
      CHECK (type IN ('TRIGGER', 'SWAP', 'LENDING', 'CONDITION', 'WEBHOOK', 'DELAY'));
    `);
    
    // Drop the old constraint on node_executions
    await client.query(`
      ALTER TABLE node_executions 
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);
    
    // Add new constraint with LENDING included
    await client.query(`
      ALTER TABLE node_executions
      ADD CONSTRAINT valid_node_type 
      CHECK (node_type IN ('TRIGGER', 'SWAP', 'LENDING', 'CONDITION', 'WEBHOOK', 'DELAY'));
    `);
    
    logger.info('LENDING node type added to constraints successfully');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to add LENDING node type');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Removing LENDING node type from constraints...');
    
    // Revert workflow_nodes constraint
    await client.query(`
      ALTER TABLE workflow_nodes 
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);
    
    await client.query(`
      ALTER TABLE workflow_nodes
      ADD CONSTRAINT valid_node_type 
      CHECK (type IN ('TRIGGER', 'SWAP', 'CONDITION', 'WEBHOOK', 'DELAY'));
    `);
    
    // Revert node_executions constraint
    await client.query(`
      ALTER TABLE node_executions 
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);
    
    await client.query(`
      ALTER TABLE node_executions
      ADD CONSTRAINT valid_node_type 
      CHECK (node_type IN ('TRIGGER', 'SWAP', 'CONDITION', 'WEBHOOK', 'DELAY'));
    `);
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to remove LENDING node type');
    throw error;
  } finally {
    client.release();
  }
};

