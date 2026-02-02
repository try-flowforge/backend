/**
 * Migration: Clean up demo users
 * 
 * This migration removes all demo users (IDs starting with 'demo-user-')
 * and their associated data from the database.
 */

import { pool } from '../config/database';
import { logger } from '../utils/logger';

export const up = async (): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Count demo users before deletion
        const countResult = await client.query(
            "SELECT COUNT(*) as count FROM users WHERE id LIKE 'demo-user-%'"
        );
        const demoUserCount = parseInt(countResult.rows[0].count);

        logger.info({ demoUserCount }, 'Found demo users to delete');

        if (demoUserCount === 0) {
            logger.info('No demo users found, skipping migration');
            await client.query('COMMIT');
            return;
        }

        // Delete node executions for demo users' workflow executions
        await client.query(`
      DELETE FROM node_executions 
      WHERE execution_id IN (
        SELECT id FROM workflow_executions WHERE user_id LIKE 'demo-user-%'
      )
    `);
        logger.info('Deleted node executions for demo users');

        // Delete workflow executions for demo users
        await client.query(
            "DELETE FROM workflow_executions WHERE user_id LIKE 'demo-user-%'"
        );
        logger.info('Deleted workflow executions for demo users');

        // Delete workflow edges for demo users' workflows
        await client.query(`
      DELETE FROM workflow_edges 
      WHERE workflow_id IN (
        SELECT id FROM workflows WHERE user_id LIKE 'demo-user-%'
      )
    `);
        logger.info('Deleted workflow edges for demo users');

        // Delete workflow nodes for demo users' workflows
        await client.query(`
      DELETE FROM workflow_nodes 
      WHERE workflow_id IN (
        SELECT id FROM workflows WHERE user_id LIKE 'demo-user-%'
      )
    `);
        logger.info('Deleted workflow nodes for demo users');

        // Delete workflows for demo users
        await client.query(
            "DELETE FROM workflows WHERE user_id LIKE 'demo-user-%'"
        );
        logger.info('Deleted workflows for demo users');

        // Delete Slack connections for demo users
        await client.query(
            "DELETE FROM slack_connections WHERE user_id LIKE 'demo-user-%'"
        );
        logger.info('Deleted Slack connections for demo users');

        // Delete Telegram connections for demo users
        await client.query(
            "DELETE FROM telegram_connections WHERE user_id LIKE 'demo-user-%'"
        );
        logger.info('Deleted Telegram connections for demo users');

        // Delete demo users
        const deleteResult = await client.query(
            "DELETE FROM users WHERE id LIKE 'demo-user-%' RETURNING id"
        );
        logger.info({ deletedCount: deleteResult.rowCount }, 'Deleted demo users');

        await client.query('COMMIT');
        logger.info('Migration completed: Demo users cleaned up successfully');
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ error }, 'Migration failed: Error cleaning up demo users');
        throw error;
    } finally {
        client.release();
    }
};

export const down = async (): Promise<void> => {
    // This migration is not reversible - demo users are permanently deleted
    logger.warn('This migration is not reversible - demo users cannot be restored');
};
