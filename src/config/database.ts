import { Pool, PoolConfig } from 'pg';
import { logger } from '../utils/logger';
import { config } from './config';
import { DATABASE_CONSTANTS } from './constants';

const poolConfig: PoolConfig = {
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  // Pool size - use env vars if set, otherwise use constants
  min: config.database.poolMin || DATABASE_CONSTANTS.POOL_MIN,
  max: config.database.poolMax || DATABASE_CONSTANTS.POOL_MAX,
  // Timeouts
  idleTimeoutMillis: DATABASE_CONSTANTS.IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DATABASE_CONSTANTS.CONNECTION_TIMEOUT_MS,
  // Statement timeout for long-running queries
  statement_timeout: DATABASE_CONSTANTS.STATEMENT_TIMEOUT_MS,
};

export const pool = new Pool(poolConfig);

pool.on('connect', () => {
  logger.info('Database connection established');
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database error');
  process.exit(-1);
});

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ text, duration, rows: result.rowCount }, 'Executed query');
    return result;
  } catch (error) {
    logger.error({ text, error }, 'Query error');
    throw error;
  }
};

export const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query;
  const originalRelease = client.release;

  // Monkey patch the query method to add logging
  const queryProxy = function (this: any, ...args: any[]): any {
    const start = Date.now();
    const result = originalQuery.apply(this, args as any) as any;

    // Handle promise-based queries
    if (result && typeof result === 'object' && typeof result.then === 'function') {
      return result.then((queryResult: any) => {
        const duration = Date.now() - start;
        logger.debug({ duration, rows: queryResult.rowCount }, 'Client query executed');
        return queryResult;
      });
    }
    return result;
  };
  client.query = queryProxy as any;

  // Monkey patch the release method to add logging
  const releaseProxy = function (this: any, err?: Error | boolean): void {
    logger.debug('Client released');
    return originalRelease.call(this, err);
  };
  client.release = releaseProxy as any;

  return client;
};

export const testConnection = async (): Promise<boolean> => {
  try {
    await query('SELECT NOW()');
    logger.info('Database connection test successful');
    return true;
  } catch (error) {
    logger.error({ error }, 'Database connection test failed');
    return false;
  }
};
