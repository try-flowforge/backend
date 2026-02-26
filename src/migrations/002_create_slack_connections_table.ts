import { Pool } from 'pg';

export const up = async (pool: Pool): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slack_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      webhook_url TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create index for better query performance
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_slack_connections_user_id ON slack_connections(user_id);
  `);
};

export const down = async (pool: Pool): Promise<void> => {
  await pool.query(`DROP INDEX IF EXISTS idx_slack_connections_user_id;`);
  await pool.query(`DROP TABLE IF EXISTS slack_connections;`);
};
