import { Pool } from 'pg';

export const up = async (pool: Pool): Promise<void> => {
    await pool.query(`
    ALTER TABLE transaction_intents
      ADD COLUMN IF NOT EXISTS safe_tx_hash TEXT,
      ADD COLUMN IF NOT EXISTS safe_tx_data  JSONB;
  `);
};

export const down = async (pool: Pool): Promise<void> => {
    await pool.query(`
    ALTER TABLE transaction_intents
      DROP COLUMN IF EXISTS safe_tx_hash,
      DROP COLUMN IF EXISTS safe_tx_data;
  `);
};
