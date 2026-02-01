import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
    logger.info('Running migration: 013_create_telegram_connections_table');

    // Create telegram_connections table (simplified - no bot_token, uses central bot)
    await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255),
      chat_id VARCHAR(255) NOT NULL,
      chat_title VARCHAR(255),
      chat_type VARCHAR(50),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, chat_id)
    );
  `);

    // Create indexes
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_telegram_connections_user_id 
    ON telegram_connections(user_id);
  `);

    logger.info('Migration completed: 013_create_telegram_connections_table');
};

export const down = async (pool: Pool): Promise<void> => {
    logger.info('Rolling back migration: 013_create_telegram_connections_table');

    await pool.query(`
    DROP TABLE IF EXISTS telegram_connections CASCADE;
  `);

    logger.info('Rollback completed: 013_create_telegram_connections_table');
};
