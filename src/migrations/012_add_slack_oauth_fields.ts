import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
    logger.info('Running migration: 003_add_slack_oauth_fields');

    // Add connection_type enum (skip if already exists)
    await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'slack_connection_type') THEN
        CREATE TYPE slack_connection_type AS ENUM ('webhook', 'oauth');
      END IF;
    END$$;
  `);

    // Add new columns for OAuth support
    await pool.query(`
    ALTER TABLE slack_connections
    ADD COLUMN connection_type slack_connection_type NOT NULL DEFAULT 'webhook',
    ADD COLUMN access_token TEXT,
    ADD COLUMN team_id VARCHAR(255),
    ADD COLUMN team_name VARCHAR(255),
    ADD COLUMN channel_id VARCHAR(255),
    ADD COLUMN channel_name VARCHAR(255),
    ADD COLUMN scope TEXT;
  `);

    // Make webhook_url nullable since OAuth connections won't use it
    await pool.query(`
    ALTER TABLE slack_connections
    ALTER COLUMN webhook_url DROP NOT NULL;
  `);

    // Add constraint: webhook_url required for webhook type, access_token required for oauth type
    await pool.query(`
    ALTER TABLE slack_connections
    ADD CONSTRAINT check_connection_type_fields CHECK (
      (connection_type = 'webhook' AND webhook_url IS NOT NULL) OR
      (connection_type = 'oauth' AND access_token IS NOT NULL AND team_id IS NOT NULL AND channel_id IS NOT NULL)
    );
  `);

    // Create index for team_id lookups
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_slack_connections_team_id ON slack_connections(team_id);
  `);

    logger.info('Migration completed: 003_add_slack_oauth_fields');
};

export const down = async (pool: Pool): Promise<void> => {
    logger.info('Rolling back migration: 003_add_slack_oauth_fields');

    // Drop constraint
    await pool.query(`
    ALTER TABLE slack_connections
    DROP CONSTRAINT IF EXISTS check_connection_type_fields;
  `);

    // Drop index
    await pool.query(`
    DROP INDEX IF EXISTS idx_slack_connections_team_id;
  `);

    // Remove new columns
    await pool.query(`
    ALTER TABLE slack_connections
    DROP COLUMN IF EXISTS connection_type,
    DROP COLUMN IF EXISTS access_token,
    DROP COLUMN IF EXISTS team_id,
    DROP COLUMN IF EXISTS team_name,
    DROP COLUMN IF EXISTS channel_id,
    DROP COLUMN IF EXISTS channel_name,
    DROP COLUMN IF EXISTS scope;
  `);

    // Make webhook_url NOT NULL again
    await pool.query(`
    ALTER TABLE slack_connections
    ALTER COLUMN webhook_url SET NOT NULL;
  `);

    // Drop enum type
    await pool.query(`
    DROP TYPE IF EXISTS slack_connection_type;
  `);

    logger.info('Rollback completed: 003_add_slack_oauth_fields');
};
