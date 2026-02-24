import { Pool } from "pg";
import { logger } from "../utils/logger";

export const up = async (pool: Pool): Promise<void> => {
  logger.info("Running migration: 051_create_agent_user_context_table");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_user_context (
      user_id VARCHAR(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  logger.info("Migration completed: 051_create_agent_user_context_table");
};

export const down = async (pool: Pool): Promise<void> => {
  logger.info("Rolling back migration: 051_create_agent_user_context_table");

  await pool.query(`DROP TABLE IF EXISTS agent_user_context CASCADE;`);

  logger.info("Rollback completed: 051_create_agent_user_context_table");
};
