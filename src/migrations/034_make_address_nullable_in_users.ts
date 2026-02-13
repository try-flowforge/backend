import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const up = async (pool: Pool): Promise<void> => {
    logger.info('Running migration: 034_make_address_nullable_in_users');

    // Make address column nullable
    await pool.query(`
    ALTER TABLE users
    ALTER COLUMN address DROP NOT NULL;
  `);

    logger.info('Migration completed: 034_make_address_nullable_in_users');
};

export const down = async (pool: Pool): Promise<void> => {
    logger.info('Rolling back migration: 034_make_address_nullable_in_users');

    // Re-add NOT NULL constraint (potentially unsafe if nulls exist)
    // We'll clean up nulls first if we ever reverse this, setting a placeholder
    await pool.query(`
    UPDATE users SET address = id || '_placeholder' WHERE address IS NULL;
    ALTER TABLE users
    ALTER COLUMN address SET NOT NULL;
  `);

    logger.info('Rollback completed: 034_make_address_nullable_in_users');
};
