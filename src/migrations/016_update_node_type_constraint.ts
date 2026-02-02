import { logger } from "../utils/logger";
import { pool } from "../config/database";

/**
 * Migration: Update node type constraint to include all supported types
 *
 * Adds support for additional node types that the frontend uses:
 * - START (mapped to TRIGGER)
 * - IF, SWITCH (mapped to CONDITION)
 * - SLACK, TELEGRAM, EMAIL (mapped to WEBHOOK)
 * - WALLET (new type for wallet nodes)
 */

export async function up(): Promise<void> {
  const client = await pool.connect();

  try {
    logger.info("Running migration: Update node type constraint");

    await client.query("BEGIN");

    // Drop the old constraint from workflow_nodes
    await client.query(`
      ALTER TABLE workflow_nodes
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

    // Add new constraint with all supported types
    await client.query(`
      ALTER TABLE workflow_nodes
      ADD CONSTRAINT valid_node_type 
      CHECK (type IN (
        'TRIGGER', 
        'SWAP', 
        'LENDING', 
        'CONDITION', 
        'WEBHOOK', 
        'DELAY',
        'WALLET',
        'START',
        'IF',
        'SWITCH',
        'SLACK',
        'TELEGRAM',
        'EMAIL'
      ));
    `);

    // Also update node_executions table constraint
    await client.query(`
      ALTER TABLE node_executions
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

    await client.query(`
      ALTER TABLE node_executions
      ADD CONSTRAINT valid_node_type 
      CHECK (node_type IN (
        'TRIGGER', 
        'SWAP', 
        'LENDING', 
        'CONDITION', 
        'WEBHOOK', 
        'DELAY',
        'WALLET',
        'START',
        'IF',
        'SWITCH',
        'SLACK',
        'TELEGRAM',
        'EMAIL'
      ));
    `);

    await client.query("COMMIT");

    logger.info("Migration completed: Node type constraint updated");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ error }, "Migration failed");
    throw error;
  } finally {
    client.release();
  }
}

export async function down(): Promise<void> {
  const client = await pool.connect();

  try {
    logger.info("Rolling back migration: Revert node type constraint");

    await client.query("BEGIN");

    // Revert workflow_nodes constraint
    await client.query(`
      ALTER TABLE workflow_nodes
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

    await client.query(`
      ALTER TABLE workflow_nodes
      ADD CONSTRAINT valid_node_type 
      CHECK (type IN ('TRIGGER', 'SWAP', 'LENDING', 'CONDITION', 'WEBHOOK', 'DELAY'));
    `);

    // Revert node_executions constraint
    await client.query(`
      ALTER TABLE node_executions
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

    await client.query(`
      ALTER TABLE node_executions
      ADD CONSTRAINT valid_node_type 
      CHECK (node_type IN ('TRIGGER', 'SWAP', 'LENDING', 'CONDITION', 'WEBHOOK', 'DELAY'));
    `);

    await client.query("COMMIT");

    logger.info("Rollback completed: Node type constraint reverted");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ error }, "Rollback failed");
    throw error;
  } finally {
    client.release();
  }
}
