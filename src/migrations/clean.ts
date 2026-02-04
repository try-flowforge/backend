import { Pool } from "pg";
import * as dotenv from "dotenv";
import { logger } from "../utils/logger";
import * as migration001 from "./001_create_users_table";
import * as migration002 from "./002_create_slack_connections_table";
import * as migration003 from "./003_encrypt_existing_webhooks";
import * as migration004 from "./004_create_workflows_tables";
import * as migration005 from "./005_create_workflow_nodes_table";
import * as migration006 from "./006_create_workflow_edges_table";
import * as migration007 from "./007_create_workflow_executions_table";
import * as migration008 from "./008_create_node_executions_table";
import * as migration009 from "./009_create_swap_executions_table";
import * as migration010 from "./010_create_managed_wallets_table";
import * as migration011 from "./011_add_foreign_key_to_workflows";
import * as migration012 from "./012_add_slack_oauth_fields";
import * as migration013 from "./013_create_telegram_connections_table";
import * as migration014 from "./014_add_edge_handles";
import * as migration015 from "./015_add_safe_wallet_to_users";
import * as migration016 from "./016_update_node_type_constraint";
import * as migration017 from "./017_create_telegram_verification_codes_table";
import * as migration018 from "./018_cleanup_demo_users";
import * as migration019 from "./019_create_lending_executions_table";
import * as migration020 from "./020_add_lending_node_type";
import * as migration021 from "./021_add_aave_compound_node_types";
import * as migration022 from "./022_add_llm_transform_node_type";

// Load environment variables
dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "agentic_workflow",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

/**
 * Truncate all tables (keeps schema, removes data)
 */
const truncateAll = async (): Promise<void> => {
  try {
    logger.info("Starting database truncate...");

    // Get all table names
    const tablesResult = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    const tables = tablesResult.rows.map((row) => row.tablename);

    if (tables.length === 0) {
      logger.info("No tables found to truncate");
      return;
    }

    // Disable foreign key checks temporarily (PostgreSQL doesn't have this, but we can use TRUNCATE CASCADE)
    // Truncate all tables
    for (const table of tables) {
      logger.info(`Truncating table: ${table}`);
      await pool.query(`TRUNCATE TABLE "${table}" CASCADE;`);
    }

    logger.info("Database truncate completed successfully");
  } catch (error) {
    logger.error({ error }, "Database truncate failed");
    throw error;
  } finally {
    await pool.end();
  }
};

/**
 * Reset database (drops all tables and re-runs migrations)
 */
const resetDatabase = async (): Promise<void> => {
  try {
    logger.info("Starting database reset...");

    // Get all table names
    const tablesResult = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    const tables = tablesResult.rows.map((row) => row.tablename);

    if (tables.length > 0) {
      // Drop all tables
      logger.info("Dropping all tables...");
      for (const table of tables) {
        logger.info(`Dropping table: ${table}`);
        await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
      }
    }

    // Re-run migrations
    logger.info("Re-running migrations...");
    await migration001.up(pool);
    await migration002.up(pool);
    await migration003.up(pool);
    await migration004.up(pool);
    await migration005.up(pool);
    await migration006.up(pool);
    await migration007.up(pool);
    await migration008.up(pool);
    await migration009.up(pool);
    await migration010.up(pool);
    await migration011.up(pool);
    await migration012.up(pool);
    await migration013.up(pool);
    await migration014.up();
    await migration015.up(pool);
    await migration016.up();
    await migration017.up();
    await migration018.up();
    await migration019.up(pool);
    await migration020.up(pool);
    await migration021.up(pool);
    await migration022.up(pool);

    // Record migrations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [1, "001_create_users_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [2, "002_create_slack_connections_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [3, "003_encrypt_existing_webhooks"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [4, "004_create_workflows_tables"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [5, "005_create_workflow_nodes_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [6, "006_create_workflow_edges_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [7, "007_create_workflow_executions_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [8, "008_create_node_executions_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [9, "009_create_swap_executions_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [10, "010_create_managed_wallets_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [11, "011_add_foreign_key_to_workflows"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [12, "012_add_slack_oauth_fields"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [13, "013_create_telegram_connections_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [14, "014_add_edge_handles"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [15, "015_add_safe_wallet_to_users"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [16, "016_update_node_type_constraint"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [17, "017_create_telegram_verification_codes_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [18, "018_cleanup_demo_users"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [19, "019_create_lending_executions_table"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [20, "020_add_lending_node_type"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [21, "021_add_aave_compound_node_types"]
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [22, "022_add_llm_transform_node_type"]
    );
    logger.info("Database reset completed successfully");
  } catch (error) {
    logger.error({ error }, "Database reset failed");
    throw error;
  } finally {
    await pool.end();
  }
};

// CLI interface
const command = process.argv[2];

if (command === "truncate") {
  truncateAll().catch((error) => {
    logger.error({ error }, "Failed to truncate database");
    process.exit(1);
  });
} else if (command === "reset") {
  resetDatabase().catch((error) => {
    logger.error({ error }, "Failed to reset database");
    process.exit(1);
  });
} else {
  logger.info("Usage: node clean.js [truncate|reset]");
  logger.info("  truncate - Clears all data but keeps schema");
  logger.info("  reset    - Drops all tables and re-runs migrations");
  process.exit(1);
}
