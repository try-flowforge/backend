import { Pool } from "pg";
import { createClient } from "redis";
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
import * as migration023 from "./023_add_workflow_visibility_fields";
import * as migration024 from "./024_add_workflow_versioning";
import * as migration025 from "./025_add_lifi_node_type";
import * as migration026 from "./026_add_lifi_swap_provider";
import * as migration027 from "./027_add_eth_sepolia_safe_wallet_and_chain_constraints";
import * as migration028 from "./028_add_uniswap_v4_swap_provider";
import * as migration029 from "./029_add_remaining_sponsored_txs_to_users";
import * as migration030 from "./030_create_user_ens_subdomains_table";
import * as migration031 from "./031_add_selected_chains_to_users";
import * as migration032 from "./032_migrate_safe_wallets_to_jsonb";
import * as migration033 from "./033_restore_remaining_sponsored_txs_to_users";
import * as migration034 from "./034_make_address_nullable_in_users";
import * as migration035 from "./035_add_price_oracle_and_api_node_types";
import * as migration036 from "./036_create_transaction_intents_table";
import * as migration037 from "./037_add_execution_paused_state";
import * as migration038 from "./038_add_safe_tx_to_intents";
import * as migration039 from "./039_add_time_block_trigger_type";
import * as migration040 from "./040_create_time_blocks_table";
import * as migration041 from "./041_add_time_block_node_type";
import * as migration042 from "./042_create_ostium_delegations_table";
import * as migration043 from "./043_create_perps_executions_table";
import * as migration044 from "./044_add_perps_node_type";
import * as migration045 from "./045_remove_relay_oneinch_swap_providers";
import * as migration046 from "./046_drop_user_ens_subdomains_table";
import * as migration047 from "./047_remove_unsupported_chains";
import * as migration049 from "./049_remove_uniswap_v3_swap_provider";
import * as migration048 from "./048_add_waiting_for_client_tx_status";
import * as migration050 from "./050_db_optimization_indexes_and_fks";
import * as migration051 from "./051_create_agent_user_context_table";

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
    // Get all table names
    const tablesResult = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    const tables = tablesResult.rows.map((row) => row.tablename);

    if (tables.length === 0) {
      return;
    }

    for (const table of tables) {
      await pool.query(`TRUNCATE TABLE "${table}" CASCADE;`);
    }

  } catch (error) {
    logger.error({ error }, "Database truncate failed");
    throw error;
  } finally {
    await pool.end();
  }
};

/**
 * Flush all Redis keys (no schema, just data)
 */
const flushRedis = async (): Promise<void> => {
  const host = process.env.REDIS_HOST || "localhost";
  const port = parseInt(process.env.REDIS_PORT || "6379", 10);
  const password = process.env.REDIS_PASSWORD;
  const client = createClient({
    socket: { host, port },
    password: password || undefined,
  });
  await client.connect();
  await client.flushAll();
  await client.quit();
};

/**
 * Clear all data: truncate Postgres tables + flush Redis. No schema changes.
 */
const clearAll = async (): Promise<void> => {
  await truncateAll();
  await flushRedis();
};

/**
 * Reset database (drops all tables and re-runs migrations)
 */
const resetMigrations: { name: string; tables: string[]; up: (p: Pool) => Promise<void> }[] = [
  {
    name: "001_create_users_table",
    tables: ["users"],
    up: migration001.up,
  },
  {
    name: "002_create_slack_connections_table",
    tables: ["slack_connections"],
    up: migration002.up,
  },
  {
    name: "003_encrypt_existing_webhooks",
    tables: ["slack_connections"],
    up: migration003.up,
  },
  {
    name: "004_create_workflows_tables",
    tables: ["workflows"],
    up: migration004.up,
  },
  {
    name: "005_create_workflow_nodes_table",
    tables: ["workflow_nodes"],
    up: migration005.up,
  },
  {
    name: "006_create_workflow_edges_table",
    tables: ["workflow_edges"],
    up: migration006.up,
  },
  {
    name: "007_create_workflow_executions_table",
    tables: ["workflow_executions"],
    up: migration007.up,
  },
  {
    name: "008_create_node_executions_table",
    tables: ["node_executions"],
    up: migration008.up,
  },
  {
    name: "009_create_swap_executions_table",
    tables: ["swap_executions"],
    up: migration009.up,
  },
  {
    name: "010_create_managed_wallets_table",
    tables: ["managed_wallets"],
    up: migration010.up,
  },
  {
    name: "011_add_foreign_key_to_workflows",
    tables: ["workflows"],
    up: migration011.up,
  },
  {
    name: "012_add_slack_oauth_fields",
    tables: ["slack_connections"],
    up: migration012.up,
  },
  {
    name: "013_create_telegram_connections_table",
    tables: ["telegram_connections"],
    up: migration013.up,
  },
  {
    name: "014_add_edge_handles",
    tables: ["workflow_edges"],
    up: migration014.up,
  },
  {
    name: "015_add_safe_wallet_to_users",
    tables: ["users"],
    up: migration015.up,
  },
  {
    name: "016_update_node_type_constraint",
    tables: ["workflow_nodes", "node_executions"],
    up: migration016.up,
  },
  {
    name: "017_create_telegram_verification_codes_table",
    tables: ["telegram_verification_codes"],
    up: migration017.up,
  },
  {
    name: "018_cleanup_demo_users",
    tables: ["users", "workflow_executions", "node_executions", "workflows", "workflow_nodes", "workflow_edges"],
    up: migration018.up,
  },
  {
    name: "019_create_lending_executions_table",
    tables: ["lending_executions"],
    up: migration019.up,
  },
  {
    name: "020_add_lending_node_type",
    tables: ["workflow_nodes", "node_executions"],
    up: migration020.up,
  },
  {
    name: "021_add_aave_compound_node_types",
    tables: ["workflow_nodes", "node_executions"],
    up: migration021.up,
  },
  {
    name: "022_add_llm_transform_node_type",
    tables: ["workflow_nodes", "node_executions"],
    up: migration022.up,
  },
  {
    name: "023_add_workflow_visibility_fields",
    tables: ["workflows"],
    up: migration023.up,
  },
  {
    name: "024_add_workflow_versioning",
    tables: ["workflows", "workflow_version_history", "workflow_executions"],
    up: migration024.up,
  },
  {
    name: "025_add_lifi_node_type",
    tables: ["workflow_nodes", "node_executions"],
    up: migration025.up,
  },
  {
    name: "026_add_lifi_swap_provider",
    tables: ["swap_executions"],
    up: migration026.up,
  },
  {
    name: "027_add_eth_sepolia_safe_wallet_and_chain_constraints",
    tables: ["users", "swap_executions", "lending_executions", "managed_wallets"],
    up: migration027.up,
  },
  {
    name: "028_add_uniswap_v4_swap_provider",
    tables: ["swap_executions"],
    up: migration028.up,
  },
  {
    name: "029_add_remaining_sponsored_txs_to_users",
    tables: ["users"],
    up: migration029.up,
  },
  {
    name: "030_create_user_ens_subdomains_table",
    tables: ["user_ens_subdomains"],
    up: migration030.up,
  },
  {
    name: "031_add_selected_chains_to_users",
    tables: ["users"],
    up: migration031.up,
  },
  {
    name: "032_migrate_safe_wallets_to_jsonb",
    tables: ["users"],
    up: migration032.up,
  },
  {
    name: "033_restore_remaining_sponsored_txs_to_users",
    tables: ["users"],
    up: migration033.up,
  },
  {
    name: "034_make_address_nullable_in_users",
    tables: ["users"],
    up: migration034.up,
  },
  {
    name: "035_add_price_oracle_and_api_node_types",
    tables: ["workflow_nodes", "node_executions"],
    up: migration035.up,
  },
  {
    name: "036_create_transaction_intents_table",
    tables: ["transaction_intents"],
    up: migration036.up,
  },
  {
    name: "037_add_execution_paused_state",
    tables: ["workflow_executions", "node_executions", "swap_executions", "lending_executions"],
    up: migration037.up,
  },
  {
    name: "038_add_safe_tx_to_intents",
    tables: ["transaction_intents"],
    up: migration038.up,
  },
  {
    name: "039_add_time_block_trigger_type",
    tables: ["workflow_executions"],
    up: migration039.up,
  },
  {
    name: "040_create_time_blocks_table",
    tables: ["time_blocks"],
    up: migration040.up,
  },
  {
    name: "041_add_time_block_node_type",
    tables: ["workflow_nodes", "node_executions"],
    up: migration041.up,
  },
  {
    name: "042_create_ostium_delegations_table",
    tables: ["ostium_delegations"],
    up: migration042.up,
  },
  {
    name: "043_create_perps_executions_table",
    tables: ["perps_executions"],
    up: migration043.up,
  },
  {
    name: "044_add_perps_node_type",
    tables: ["workflow_nodes", "node_executions"],
    up: migration044.up,
  },
  {
    name: "045_remove_relay_oneinch_swap_providers",
    tables: ["swap_executions"],
    up: migration045.up,
  },
  {
    name: "046_drop_user_ens_subdomains_table",
    tables: ["user_ens_subdomains"],
    up: migration046.up,
  },
  {
    name: "047_remove_unsupported_chains",
    tables: ["swap_executions", "lending_executions", "managed_wallets"],
    up: migration047.up,
  },
  {
    name: "048_add_waiting_for_client_tx_status",
    tables: ["node_executions", "workflow_executions", "swap_executions", "lending_executions"],
    up: migration048.up,
  },
  {
    name: "049_remove_uniswap_v3_swap_provider",
    tables: ["swap_executions"],
    up: migration049.up,
  },
  {
    name: "050_db_optimization_indexes_and_fks",
    tables: ["workflow_executions", "node_executions", "workflow_version_history", "transaction_intents", "slack_connections"],
    up: migration050.up,
  },
  {
    name: "051_create_agent_user_context_table",
    tables: ["agent_user_context"],
    up: migration051.up,
  },
];

const resetDatabase = async (): Promise<void> => {
  try {
    const tablesResult = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);
    const tableNames = tablesResult.rows.map((row) => row.tablename);
    for (const table of tableNames) {
      await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
    }

    for (const m of resetMigrations) {
      logger.info(`Running migration: ${m.name} [${m.tables.join(", ")}]`);
      await m.up(pool);
    }

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
      [1, "001_create_users_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [2, "002_create_slack_connections_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [3, "003_encrypt_existing_webhooks"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [4, "004_create_workflows_tables"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [5, "005_create_workflow_nodes_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [6, "006_create_workflow_edges_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [7, "007_create_workflow_executions_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [8, "008_create_node_executions_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [9, "009_create_swap_executions_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [10, "010_create_managed_wallets_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [11, "011_add_foreign_key_to_workflows"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [12, "012_add_slack_oauth_fields"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [13, "013_create_telegram_connections_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [14, "014_add_edge_handles"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [15, "015_add_safe_wallet_to_users"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [16, "016_update_node_type_constraint"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [17, "017_create_telegram_verification_codes_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [18, "018_cleanup_demo_users"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [19, "019_create_lending_executions_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [20, "020_add_lending_node_type"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [21, "021_add_aave_compound_node_types"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [22, "022_add_llm_transform_node_type"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [23, "023_add_workflow_visibility_fields"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [24, "024_add_workflow_versioning"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [25, "025_add_lifi_node_type"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [26, "026_add_lifi_swap_provider"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [27, "027_add_eth_sepolia_safe_wallet_and_chain_constraints"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [28, "028_add_uniswap_v4_swap_provider"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [29, "029_add_remaining_sponsored_txs_to_users"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [30, "030_create_user_ens_subdomains_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [31, "031_add_selected_chains_to_users"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [32, "032_migrate_safe_wallets_to_jsonb"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [33, "033_restore_remaining_sponsored_txs_to_users"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [34, "034_make_address_nullable_in_users"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [35, "035_add_price_oracle_and_api_node_types"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [36, "036_create_transaction_intents_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [37, "037_add_execution_paused_state"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [38, "038_add_safe_tx_to_intents"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [39, "039_add_time_block_trigger_type"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [40, "040_create_time_blocks_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [41, "041_add_time_block_node_type"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [42, "042_create_ostium_delegations_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [43, "043_create_perps_executions_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [44, "044_add_perps_node_type"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [45, "045_remove_relay_oneinch_swap_providers"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [46, "046_drop_user_ens_subdomains_table"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [47, "047_remove_unsupported_chains"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [49, "049_remove_uniswap_v3_swap_provider"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [48, "048_add_waiting_for_client_tx_status"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [50, "050_db_optimization_indexes_and_fks"],
    );
    await pool.query(
      "INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [51, "051_create_agent_user_context_table"],
    );
  } catch (error) {
    logger.error({ error }, "Database reset failed");
    throw error;
  } finally {
    await pool.end();
  }
};

// CLI interface
const command = process.argv[2];

if (command === "clear") {
  clearAll()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error({ error }, "Failed to clear data");
      process.exit(1);
    });
} else if (command === "reset") {
  resetDatabase()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error({ error }, "Failed to reset database");
      process.exit(1);
    });
} else {
  logger.info("Usage: node clean.js [clear|reset]");
  logger.info("  clear - Clears all data (Postgres truncate + Redis flush), keeps schema");
  logger.info("  reset - Drops all tables and re-runs migrations (data + schema reset)");
  process.exit(1);
}
