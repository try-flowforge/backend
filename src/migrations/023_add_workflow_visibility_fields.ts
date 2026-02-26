import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');


    // Check if columns already exist
    const columnsExist = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'workflows' 
      AND column_name IN ('is_public', 'published_at')
    `);

    if (columnsExist.rows.length === 0) {
      // Add is_public column
      await client.query(`
        ALTER TABLE workflows
        ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN published_at TIMESTAMP WITH TIME ZONE;
      `);
    } else {
    }

    // Create index for public workflows (partial index for better performance)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflows_is_public 
      ON workflows(is_public) 
      WHERE is_public = true;
    `);

    // Create index for published_at (for sorting public workflows by publish date)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflows_published_at 
      ON workflows(published_at DESC) 
      WHERE is_public = true;
    `);

    // Create GIN index on tags for efficient tag filtering
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflows_tags 
      ON workflows USING GIN(tags);
    `);

    // Create composite index for public workflow queries with filters
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workflows_public_updated 
      ON workflows(is_public, updated_at DESC) 
      WHERE is_public = true;
    `);


    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to add workflow visibility fields');
    throw error;
  } finally {
    client.release();
  }
};

export const down = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');


    // Drop indexes
    await client.query('DROP INDEX IF EXISTS idx_workflows_is_public;');
    await client.query('DROP INDEX IF EXISTS idx_workflows_published_at;');
    await client.query('DROP INDEX IF EXISTS idx_workflows_tags;');
    await client.query('DROP INDEX IF EXISTS idx_workflows_public_updated;');

    // Drop columns
    await client.query(`
      ALTER TABLE workflows
      DROP COLUMN IF EXISTS is_public,
      DROP COLUMN IF EXISTS published_at;
    `);


    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to remove workflow visibility fields');
    throw error;
  } finally {
    client.release();
  }
};
