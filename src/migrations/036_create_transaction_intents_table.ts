import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
    logger.info('Running migration: 036_create_transaction_intents_table');

    await pool.query(`
    CREATE TABLE IF NOT EXISTS transaction_intents (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      agent_user_id VARCHAR(255) NOT NULL,
      safe_address VARCHAR(255) NOT NULL,
      chain_id INTEGER NOT NULL,
      
      "to" VARCHAR(255) NOT NULL,
      value VARCHAR(255) NOT NULL,
      data TEXT NOT NULL,
      
      description TEXT,
      
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      tx_hash VARCHAR(255),
      
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

    // Create indexes for faster lookups when polling or searching for a user's intents
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_transaction_intents_user_id ON transaction_intents(user_id);
  `);

    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_transaction_intents_agent_user_id ON transaction_intents(agent_user_id);
  `);

    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_transaction_intents_status ON transaction_intents(status);
  `);

    logger.info('Migration completed: 036_create_transaction_intents_table');
};

export const down = async (pool: Pool): Promise<void> => {
    logger.info('Rolling back migration: 036_create_transaction_intents_table');

    await pool.query(`DROP INDEX IF EXISTS idx_transaction_intents_status;`);
    await pool.query(`DROP INDEX IF EXISTS idx_transaction_intents_agent_user_id;`);
    await pool.query(`DROP INDEX IF EXISTS idx_transaction_intents_user_id;`);
    await pool.query(`DROP TABLE IF EXISTS transaction_intents;`);

    logger.info('Rollback completed: 036_create_transaction_intents_table');
};
