import { Pool } from 'pg';

export const up = async (pool: Pool): Promise<void> => {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS remaining_sponsored_txs INTEGER NOT NULL DEFAULT 3;
  `);
};

export const down = async (pool: Pool): Promise<void> => {
  await pool.query(`
    ALTER TABLE users DROP COLUMN IF EXISTS remaining_sponsored_txs;
  `);
};
