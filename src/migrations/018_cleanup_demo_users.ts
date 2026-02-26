import { pool } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Migration: Clean up demo users
 * 
 * This migration removes all demo users (IDs starting with 'demo-user-')
 * and their associated data from the database.
 */
export const up = async (): Promise<void> => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Count demo users before deletion
        const countResult = await client.query(
            "SELECT COUNT(*) as count FROM users WHERE id LIKE 'demo-user-%'"
        );
        const demoUserCount = parseInt(countResult.rows[0].count);

        if (demoUserCount === 0) {
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

        // Delete workflow executions for demo users
        await client.query(
            "DELETE FROM workflow_executions WHERE user_id LIKE 'demo-user-%'"
        );

        // Delete workflow edges for demo users' workflows
        await client.query(`
      DELETE FROM workflow_edges 
      WHERE workflow_id IN (
        SELECT id FROM workflows WHERE user_id LIKE 'demo-user-%'
      )
    `);

        // Delete workflow nodes for demo users' workflows
        await client.query(`
      DELETE FROM workflow_nodes 
      WHERE workflow_id IN (
        SELECT id FROM workflows WHERE user_id LIKE 'demo-user-%'
      )
    `);

        // Delete workflows for demo users
        await client.query(
            "DELETE FROM workflows WHERE user_id LIKE 'demo-user-%'"
        );

        // Delete Slack connections for demo users
        await client.query(
            "DELETE FROM slack_connections WHERE user_id LIKE 'demo-user-%'"
        );

        // Delete Telegram connections for demo users
        await client.query(
            "DELETE FROM telegram_connections WHERE user_id LIKE 'demo-user-%'"
        );

        // Delete demo users
        await client.query(
            "DELETE FROM users WHERE id LIKE 'demo-user-%' RETURNING id"
        );

        await client.query('COMMIT');
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
