import { Pool } from 'pg';

export const up = async (pool: Pool): Promise<void> => {
    // Make address column nullable
    await pool.query(`
    ALTER TABLE users
    ALTER COLUMN address DROP NOT NULL;
  `);
};

export const down = async (pool: Pool): Promise<void> => {
    // Re-add NOT NULL constraint (potentially unsafe if nulls exist)
    // We'll clean up nulls first if we ever reverse this, setting a placeholder
    await pool.query(`
    UPDATE users SET address = id || '_placeholder' WHERE address IS NULL;
    ALTER TABLE users
    ALTER COLUMN address SET NOT NULL;
  `);
};
