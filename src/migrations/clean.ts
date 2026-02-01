import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { logger } from '../utils/logger';
import * as migration001 from './001_create_users_table';

// Load environment variables
dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'agentic_workflow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

/**
 * Truncate all tables (keeps schema, removes data)
 */
const truncateAll = async (): Promise<void> => {
  try {
    logger.info('Starting database truncate...');

    // Get all table names
    const tablesResult = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    const tables = tablesResult.rows.map((row) => row.tablename);

    if (tables.length === 0) {
      logger.info('No tables found to truncate');
      return;
    }

    // Disable foreign key checks temporarily (PostgreSQL doesn't have this, but we can use TRUNCATE CASCADE)
    // Truncate all tables
    for (const table of tables) {
      logger.info(`Truncating table: ${table}`);
      await pool.query(`TRUNCATE TABLE "${table}" CASCADE;`);
    }

    logger.info('Database truncate completed successfully');
  } catch (error) {
    logger.error({ error }, 'Database truncate failed');
    throw error;
  } finally {
    await pool.end();
  }
};

/**
 * Reset database (drops all tables and re-runs migrations)
 */
const resetDatabase = async (): Promise<void> => {
  try {
    logger.info('Starting database reset...');

    // Get all table names
    const tablesResult = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    const tables = tablesResult.rows.map((row) => row.tablename);

    if (tables.length > 0) {
      // Drop all tables
      logger.info('Dropping all tables...');
      for (const table of tables) {
        logger.info(`Dropping table: ${table}`);
        await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
      }
    }

    // Re-run migrations
    logger.info('Re-running migrations...');
    await migration001.up(pool);

    // Record migration
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query('INSERT INTO migrations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [
      1,
      '001_create_users_table',
    ]);

    logger.info('Database reset completed successfully');
  } catch (error) {
    logger.error({ error }, 'Database reset failed');
    throw error;
  } finally {
    await pool.end();
  }
};

// CLI interface
const command = process.argv[2];

if (command === 'truncate') {
  truncateAll().catch((error) => {
    logger.error({ error }, 'Failed to truncate database');
    process.exit(1);
  });
} else if (command === 'reset') {
  resetDatabase().catch((error) => {
    logger.error({ error }, 'Failed to reset database');
    process.exit(1);
  });
} else {
  logger.info('Usage: node clean.js [truncate|reset]');
  logger.info('  truncate - Clears all data but keeps schema');
  logger.info('  reset    - Drops all tables and re-runs migrations');
  process.exit(1);
}
