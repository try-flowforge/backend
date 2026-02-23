import { Pool } from 'pg';
import pino from 'pino';

const logger = pino({ name: 'Migration_047_remove_unsupported_chains' });

/**
 * Migration 047: Remove unneeded chains from database constraints
 * Updates the 'valid_chain' and 'valid_lending_chain' CHECK constraints to ONLY
 * allow 'ARBITRUM' and 'ARBITRUM_SEPOLIA'.
 */
export async function up(pool: Pool): Promise<void> {
    logger.info('Running migration: 047_remove_unsupported_chains');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. swap_executions: drop and recreate valid_chain
        await client.query(`ALTER TABLE swap_executions DROP CONSTRAINT IF EXISTS valid_chain;`);
        await client.query(`
      ALTER TABLE swap_executions 
      ADD CONSTRAINT valid_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA'));
    `);

        // 2. lending_executions: drop and recreate valid_lending_chain
        await client.query(`ALTER TABLE lending_executions DROP CONSTRAINT IF EXISTS valid_lending_chain;`);
        await client.query(`
      ALTER TABLE lending_executions 
      ADD CONSTRAINT valid_lending_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA'));
    `);

        // 3. managed_wallets: drop and recreate valid_chain
        // Also ensuring no rows are breaking constraints. If they are, it will fail (which is good).
        await client.query(`ALTER TABLE managed_wallets DROP CONSTRAINT IF EXISTS valid_chain;`);
        await client.query(`
      ALTER TABLE managed_wallets 
      ADD CONSTRAINT valid_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA'));
    `);

        await client.query('COMMIT');
        logger.info('Migration completed: 047_remove_unsupported_chains');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function down(pool: Pool): Promise<void> {
    logger.info('Rolling back migration: 047_remove_unsupported_chains');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // In previous state, ETHEREUM_SEPOLIA and SEPOLIA (legacy) were somewhat allowed.
        // Rolling back to 027 state:
        await client.query(`ALTER TABLE swap_executions DROP CONSTRAINT IF EXISTS valid_chain;`);
        await client.query(`
      ALTER TABLE swap_executions 
      ADD CONSTRAINT valid_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA', 'ETHEREUM_SEPOLIA'));
    `);

        await client.query(`ALTER TABLE lending_executions DROP CONSTRAINT IF EXISTS valid_lending_chain;`);
        await client.query(`
      ALTER TABLE lending_executions 
      ADD CONSTRAINT valid_lending_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA', 'ETHEREUM_SEPOLIA'));
    `);

        await client.query(`ALTER TABLE managed_wallets DROP CONSTRAINT IF EXISTS valid_chain;`);
        await client.query(`
      ALTER TABLE managed_wallets 
      ADD CONSTRAINT valid_chain CHECK (chain IN ('ARBITRUM', 'ARBITRUM_SEPOLIA', 'ETHEREUM_SEPOLIA'));
    `);

        await client.query('COMMIT');
        logger.info('Rollback completed: 047_remove_unsupported_chains');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
