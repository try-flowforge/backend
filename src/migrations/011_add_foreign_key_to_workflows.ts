import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Adding foreign key constraint to workflows table...');
    
    // Add foreign key constraint for trigger_node_id
    await client.query(`
      ALTER TABLE workflows
      ADD CONSTRAINT fk_workflows_trigger_node
      FOREIGN KEY (trigger_node_id)
      REFERENCES workflow_nodes(id)
      ON DELETE SET NULL;
    `);
    
    logger.info('Foreign key constraint added successfully');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to add foreign key constraint');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    logger.info('Dropping foreign key constraint from workflows table...');
    await client.query(`
      ALTER TABLE workflows
      DROP CONSTRAINT IF EXISTS fk_workflows_trigger_node;
    `);
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to drop foreign key constraint');
    throw error;
  } finally {
    client.release();
  }
};

