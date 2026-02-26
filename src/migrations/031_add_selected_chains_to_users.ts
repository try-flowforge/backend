import { Pool } from 'pg';

export const up = async (pool: Pool): Promise<void> => {
    await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS selected_chains TEXT[] DEFAULT NULL;
  `);
};

export const down = async (pool: Pool): Promise<void> => {
    await pool.query(`
    ALTER TABLE users DROP COLUMN IF EXISTS selected_chains;
  `);
};
