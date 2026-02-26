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
    await client.query("BEGIN");

    // Drop the old constraint from workflow_nodes (idempotent)
    await client.query(`
      ALTER TABLE workflow_nodes
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

    // Check if constraint exists before adding
    const constraintExists = await client.query(`
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'valid_node_type' 
      AND conrelid = 'workflow_nodes'::regclass
    `);

    if (constraintExists.rows.length === 0) {
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
    }

    // Also update node_executions table constraint (idempotent)
    await client.query(`
      ALTER TABLE node_executions
      DROP CONSTRAINT IF EXISTS valid_node_type;
    `);

    const nodeExecConstraintExists = await client.query(`
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'valid_node_type' 
      AND conrelid = 'node_executions'::regclass
    `);

    if (nodeExecConstraintExists.rows.length === 0) {
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
    }

    await client.query("COMMIT");

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

  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ error }, "Rollback failed");
    throw error;
  } finally {
    client.release();
  }
}
