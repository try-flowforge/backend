import { Pool } from 'pg';
import { logger } from '../utils/logger';

/**
 * Migration: Add workflow versioning system
 *
 * This migration adds version tracking to workflows:
 * 1. Adds version column to workflows table
 * 2. Creates workflow_version_history table for version snapshots
 * 3. Adds version_number to workflow_executions for tracking which version was executed
 */

export const up = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        logger.info('Adding workflow versioning support...');

        // 1. Add version columns to workflows table
        const versionColumnExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'workflows' AND column_name = 'version'
      );
    `);

        if (!versionColumnExists.rows[0].exists) {
            await client.query(`
        ALTER TABLE workflows 
        ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      `);
            logger.info('Added version column to workflows table');
        } else {
            logger.info('Version column already exists in workflows table');
        }

        // Add version_created_at column
        const versionCreatedAtExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'workflows' AND column_name = 'version_created_at'
      );
    `);

        if (!versionCreatedAtExists.rows[0].exists) {
            await client.query(`
        ALTER TABLE workflows 
        ADD COLUMN version_created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      `);
            logger.info('Added version_created_at column to workflows table');
        }

        // 2. Create workflow_version_history table
        const versionHistoryTableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'workflow_version_history'
      );
    `);

        if (!versionHistoryTableExists.rows[0].exists) {
            await client.query(`
        CREATE TABLE workflow_version_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          change_summary TEXT,
          nodes_snapshot JSONB NOT NULL,
          edges_snapshot JSONB NOT NULL,
          workflow_metadata JSONB,
          created_by VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          CONSTRAINT unique_workflow_version UNIQUE(workflow_id, version_number)
        );
      `);
            logger.info('Created workflow_version_history table');

            // Create indexes
            await client.query(`
        CREATE INDEX idx_version_history_workflow_id 
        ON workflow_version_history(workflow_id);
      `);
            await client.query(`
        CREATE INDEX idx_version_history_created_at 
        ON workflow_version_history(created_at DESC);
      `);
            logger.info('Created indexes for workflow_version_history');
        } else {
            logger.info('workflow_version_history table already exists');
        }

        // 3. Add version_number to workflow_executions
        const executionVersionExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'workflow_executions' AND column_name = 'version_number'
      );
    `);

        if (!executionVersionExists.rows[0].exists) {
            await client.query(`
        ALTER TABLE workflow_executions 
        ADD COLUMN version_number INTEGER DEFAULT 1;
      `);
            logger.info('Added version_number column to workflow_executions table');

            // Create index for version-based queries
            await client.query(`
        CREATE INDEX idx_workflow_executions_version 
        ON workflow_executions(workflow_id, version_number);
      `);
            logger.info('Created index for workflow_executions version_number');
        } else {
            logger.info('version_number column already exists in workflow_executions');
        }

        await client.query('COMMIT');
        logger.info('Workflow versioning migration completed successfully');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Failed to run workflow versioning migration');
        throw error;
    } finally {
        client.release();
    }
};

export const down = async (pool: Pool): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        logger.info('Rolling back workflow versioning migration...');

        // Remove version_number from workflow_executions
        await client.query(`
      ALTER TABLE workflow_executions 
      DROP COLUMN IF EXISTS version_number;
    `);

        // Drop workflow_version_history table
        await client.query(`
      DROP TABLE IF EXISTS workflow_version_history CASCADE;
    `);

        // Remove version columns from workflows
        await client.query(`
      ALTER TABLE workflows 
      DROP COLUMN IF EXISTS version,
      DROP COLUMN IF EXISTS version_created_at;
    `);

        await client.query('COMMIT');
        logger.info('Workflow versioning migration rolled back successfully');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Failed to rollback workflow versioning migration');
        throw error;
    } finally {
        client.release();
    }
};
