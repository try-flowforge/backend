import { Pool } from "pg";
import { logger } from "../utils/logger";

export async function up(pool: Pool): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        logger.info("Dropping user_ens_subdomains table...");

        await client.query(`
      DROP TABLE IF EXISTS user_ens_subdomains;
    `);

        await client.query("COMMIT");
        logger.info("user_ens_subdomains table dropped successfully");
    } catch (error) {
        await client.query("ROLLBACK");
        logger.error({ error }, "Failed to drop user_ens_subdomains table");
        throw error;
    } finally {
        client.release();
    }
}

export async function down(pool: Pool): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        logger.info("Recreating user_ens_subdomains table...");

        await client.query(`
      CREATE TABLE IF NOT EXISTS user_ens_subdomains (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ens_name VARCHAR(255) NOT NULL UNIQUE,
        owner_address VARCHAR(42) NOT NULL,
        duration_seconds INTEGER NOT NULL,
        expiry TIMESTAMP WITH TIME ZONE NOT NULL,
        chain_id INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_user_ens_subdomains_user_id ON user_ens_subdomains(user_id);
      CREATE INDEX idx_user_ens_subdomains_ens_name ON user_ens_subdomains(ens_name);
    `);

        await client.query("COMMIT");
        logger.info("user_ens_subdomains table recreated successfully");
    } catch (error) {
        await client.query("ROLLBACK");
        logger.error({ error }, "Failed to recreate user_ens_subdomains table");
        throw error;
    } finally {
        client.release();
    }
}
