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

interface Migration {
  id: number;
  name: string;
  up: (pool: Pool) => Promise<void>;
  down: (pool: Pool) => Promise<void>;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "001_create_users_table",
    up: migration001.up,
    down: migration001.down,
  },
  {
    id: 2,
    name: "002_create_slack_connections_table",
    up: migration002.up,
    down: migration002.down,
  },
  {
    id: 3,
    name: "003_encrypt_existing_webhooks",
    up: migration003.up,
    down: migration003.down,
  },
  {
    id: 4,
    name: "004_create_workflows_tables",
    up: migration004.up,
    down: migration004.down,
  },
  {
    id: 5,
    name: "005_create_workflow_nodes_table",
    up: migration005.up,
    down: migration005.down,
  },
  {
    id: 6,
    name: "006_create_workflow_edges_table",
    up: migration006.up,
    down: migration006.down,
  },
  {
    id: 7,
    name: "007_create_workflow_executions_table",
    up: migration007.up,
    down: migration007.down,
  },
  {
    id: 8,
    name: "008_create_node_executions_table",
    up: migration008.up,
    down: migration008.down,
  },
  {
    id: 9,
    name: "009_create_swap_executions_table",
    up: migration009.up,
    down: migration009.down,
  },
  {
    id: 10,
    name: "010_create_managed_wallets_table",
    up: migration010.up,
    down: migration010.down,
  },
  {
    id: 11,
    name: "011_add_foreign_key_to_workflows",
    up: migration011.up,
    down: migration011.down,
  },
  {
    id: 12,
    name: "012_add_slack_oauth_fields",
    up: migration012.up,
    down: migration012.down,
  },
  {
    id: 13,
    name: "013_create_telegram_connections_table",
    up: migration013.up,
    down: migration013.down,
  },
  {
    id: 14,
    name: "014_add_edge_handles",
    up: migration014.up,
    down: migration014.down,
  },
  {
    id: 15,
    name: "015_add_safe_wallet_to_users",
    up: migration015.up,
    down: migration015.down,
  },
  {
    id: 16,
    name: "016_update_node_type_constraint",
    up: migration016.up,
    down: migration016.down,
  },
  {
    id: 17,
    name: "017_create_telegram_verification_codes_table",
    up: migration017.up,
    down: migration017.down,
  },
  {
    id: 18,
    name: "018_cleanup_demo_users",
    up: migration018.up,
    down: migration018.down,
  },
  {
    id: 19,
    name: "019_create_lending_executions_table",
    up: migration019.up,
    down: migration019.down,
  },
  {
    id: 20,
    name: "020_add_lending_node_type",
    up: migration020.up,
    down: migration020.down,
  },
  {
    id: 21,
    name: "021_add_aave_compound_node_types",
    up: migration021.up,
    down: migration021.down,
  },
  {
    id: 22,
    name: "022_add_llm_transform_node_type",
    up: migration022.up,
    down: migration022.down,
  },
  {
    id: 23,
    name: "023_add_workflow_visibility_fields",
    up: migration023.up,
    down: migration023.down,
  },
  {
    id: 24,
    name: "024_add_workflow_versioning",
    up: migration024.up,
    down: migration024.down,
  },
  {
    id: 25,
    name: "025_add_lifi_node_type",
    up: migration025.up,
    down: migration025.down,
  },
  {
    id: 26,
    name: "026_add_lifi_swap_provider",
    up: migration026.up,
    down: migration026.down,
  },
  {
    id: 27,
    name: "027_add_eth_sepolia_safe_wallet_and_chain_constraints",
    up: migration027.up,
    down: migration027.down,
  },
  {
    id: 28,
    name: "028_add_uniswap_v4_swap_provider",
    up: migration028.up,
    down: migration028.down,
  },
  {
    id: 29,
    name: "029_add_remaining_sponsored_txs_to_users",
    up: migration029.up,
    down: migration029.down,
  },
  {
    id: 30,
    name: "030_create_user_ens_subdomains_table",
    up: migration030.up,
    down: migration030.down,
  },
  {
    id: 31,
    name: "031_add_selected_chains_to_users",
    up: migration031.up,
    down: migration031.down,
  },
  {
    id: 32,
    name: "032_migrate_safe_wallets_to_jsonb",
    up: migration032.up,
    down: migration032.down,
  },
  {
    id: 33,
    name: "033_restore_remaining_sponsored_txs_to_users",
    up: migration033.up,
    down: migration033.down,
  },
  {
    id: 34,
    name: "034_make_address_nullable_in_users",
    up: migration034.up,
    down: migration034.down,
  },
  {
    id: 35,
    name: "035_add_price_oracle_and_api_node_types",
    up: migration035.up,
    down: migration035.down,
  },
  {
    id: 36,
    name: "036_create_transaction_intents_table",
    up: migration036.up,
    down: migration036.down,
  },
  {
    id: 37,
    name: "037_add_execution_paused_state",
    up: migration037.up,
    down: migration037.down,
  },
  {
    id: 38,
    name: "038_add_safe_tx_to_intents",
    up: migration038.up,
    down: migration038.down,
  },
  {
    id: 39,
    name: "039_add_time_block_trigger_type",
    up: migration039.up,
    down: migration039.down,
  },
  {
    id: 40,
    name: "040_create_time_blocks_table",
    up: migration040.up,
    down: migration040.down,
  },
  {
    id: 41,
    name: "041_add_time_block_node_type",
    up: migration041.up,
    down: migration041.down,
  },
  {
    id: 42,
    name: "042_create_ostium_delegations_table",
    up: migration042.up,
    down: migration042.down,
  },
  {
    id: 43,
    name: "043_create_perps_executions_table",
    up: migration043.up,
    down: migration043.down,
  },
  {
    id: 44,
    name: "044_add_perps_node_type",
    up: migration044.up,
    down: migration044.down,
  },
  {
    id: 45,
    name: "045_remove_relay_oneinch_swap_providers",
    up: migration045.up,
    down: migration045.down,
  },
  {
    id: 46,
    name: "046_drop_user_ens_subdomains_table",
    up: migration046.up,
    down: migration046.down,
  },
  {
    id: 47,
    name: "047_remove_unsupported_chains",
    up: migration047.up,
    down: migration047.down,
  },
  {
    id: 49,
    name: "049_remove_uniswap_v3_swap_provider",
    up: migration049.up,
    down: migration049.down,
  },
  {
    id: 48,
    name: "048_add_waiting_for_client_tx_status",
    up: migration048.up,
    down: migration048.down,
  },
  {
    id: 50,
    name: "050_db_optimization_indexes_and_fks",
    up: migration050.up,
    down: migration050.down,
  },
  {
    id: 51,
    name: "051_create_agent_user_context_table",
    up: migration051.up,
    down: migration051.down,
  },
];

const createMigrationsTable = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

const getExecutedMigrations = async (): Promise<number[]> => {
  const result = await pool.query("SELECT id FROM migrations ORDER BY id");
  return result.rows.map((row) => row.id);
};

const recordMigration = async (id: number, name: string): Promise<void> => {
  await pool.query("INSERT INTO migrations (id, name) VALUES ($1, $2)", [
    id,
    name,
  ]);
};

const removeMigration = async (id: number): Promise<void> => {
  await pool.query("DELETE FROM migrations WHERE id = $1", [id]);
};

const runMigrations = async (): Promise<void> => {
  try {
    logger.info("Starting migrations...");

    await createMigrationsTable();
    const executedMigrations = await getExecutedMigrations();

    for (const migration of migrations) {
      if (!executedMigrations.includes(migration.id)) {
        logger.info(`Executing migration: ${migration.name}`);
        await migration.up(pool);
        await recordMigration(migration.id, migration.name);
        logger.info(`Migration completed: ${migration.name}`);
      } else {
        logger.info(`Migration already executed: ${migration.name}`);
      }
    }

    logger.info("All migrations completed successfully");
  } catch (error) {
    logger.error({ error }, "Migration failed");
    throw error;
  } finally {
    await pool.end();
  }
};

const rollbackLastMigration = async (): Promise<void> => {
  try {
    logger.info("Rolling back last migration...");

    await createMigrationsTable();
    const executedMigrations = await getExecutedMigrations();

    if (executedMigrations.length === 0) {
      logger.info("No migrations to rollback");
      return;
    }

    const lastMigrationId = executedMigrations[executedMigrations.length - 1];
    const migration = migrations.find((m) => m.id === lastMigrationId);

    if (!migration) {
      logger.error(`Migration with id ${lastMigrationId} not found`);
      return;
    }

    logger.info(`Rolling back migration: ${migration.name}`);
    await migration.down(pool);
    await removeMigration(migration.id);
    logger.info(`Rollback completed: ${migration.name}`);
  } catch (error) {
    logger.error({ error }, "Rollback failed");
    throw error;
  } finally {
    await pool.end();
  }
};

// CLI interface
const command = process.argv[2];

if (command === "up") {
  runMigrations().catch((error) => {
    logger.error({ error }, "Failed to run migrations");
    process.exit(1);
  });
} else if (command === "down") {
  rollbackLastMigration().catch((error) => {
    logger.error({ error }, "Failed to rollback migration");
    process.exit(1);
  });
} else {
  logger.info("Usage: node run.js [up|down]");
  process.exit(1);
}
