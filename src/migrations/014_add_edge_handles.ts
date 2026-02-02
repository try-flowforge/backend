import { pool } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Migration: Add source_handle and target_handle to workflow_edges table
 * 
 * These fields enable conditional branching (IF nodes):
 * - source_handle: Identifies which output ('true'/'false') of an IF node
 * - target_handle: Identifies which input of the target node
 */

export async function up(): Promise<void> {
  const client = await pool.connect();

  try {
    logger.info('Running migration: Add source_handle and target_handle to workflow_edges');

    await client.query('BEGIN');

    // Add source_handle column (for IF node branching)
    await client.query(`
      ALTER TABLE workflow_edges
      ADD COLUMN IF NOT EXISTS source_handle VARCHAR(50);
    `);

    // Add target_handle column (for multi-input nodes, future use)
    await client.query(`
      ALTER TABLE workflow_edges
      ADD COLUMN IF NOT EXISTS target_handle VARCHAR(50);
    `);

    // Add index for efficient branch lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_edges_source_handle
      ON workflow_edges(source_node_id, source_handle)
      WHERE source_handle IS NOT NULL;
    `);

    await client.query('COMMIT');

    logger.info('Migration completed: source_handle and target_handle added to workflow_edges');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Migration failed');
    throw error;
  } finally {
    client.release();
  }
}

export async function down(): Promise<void> {
  const client = await pool.connect();

  try {
    logger.info('Rolling back migration: Remove source_handle and target_handle from workflow_edges');

    await client.query('BEGIN');

    // Drop index
    await client.query(`
      DROP INDEX IF EXISTS idx_workflow_edges_source_handle;
    `);

    // Drop columns
    await client.query(`
      ALTER TABLE workflow_edges
      DROP COLUMN IF EXISTS source_handle,
      DROP COLUMN IF EXISTS target_handle;
    `);

    await client.query('COMMIT');

    logger.info('Migration rolled back: source_handle and target_handle removed');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Migration rollback failed');
    throw error;
  } finally {
    client.release();
  }
}

