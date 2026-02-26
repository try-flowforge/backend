import { Pool } from 'pg';

export const up = async (pool: Pool): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      address VARCHAR(255) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      onboarded_at TIMESTAMP WITH TIME ZONE NOT NULL
    );
  `);

  // Create indexes for better query performance
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_address ON users(address);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);
};

export const down = async (pool: Pool): Promise<void> => {
  await pool.query(`DROP INDEX IF EXISTS idx_users_email;`);
  await pool.query(`DROP INDEX IF EXISTS idx_users_address;`);
  await pool.query(`DROP TABLE IF EXISTS users;`);
};
