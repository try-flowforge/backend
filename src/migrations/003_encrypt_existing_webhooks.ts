import { Pool } from 'pg';
import { logger } from '../utils/logger';
import { encrypt, isEncrypted } from '../utils/encryption';

/**
 * Migration to encrypt existing webhook URLs
 * This migration checks each webhook_url and encrypts it if it's not already encrypted
 */
export const up = async (pool: Pool): Promise<void> => {
  try {
    // Get all slack connections
    const result = await pool.query('SELECT id, webhook_url FROM slack_connections');
    
    if (result.rows.length === 0) {
      return;
    }

    let encryptedCount = 0;
    let alreadyEncryptedCount = 0;

    for (const row of result.rows) {
      const { id, webhook_url } = row;

      // Check if already encrypted
      if (isEncrypted(webhook_url)) {
        alreadyEncryptedCount++;
        continue;
      }

      // Encrypt the webhook URL
      try {
        const encryptedUrl = encrypt(webhook_url);
        
        await pool.query(
          'UPDATE slack_connections SET webhook_url = $1 WHERE id = $2',
          [encryptedUrl, id]
        );
        
        encryptedCount++;
      } catch (error) {
        logger.error({ error, id }, 'Failed to encrypt webhook');
        throw error;
      }
    }

  } catch (error) {
    logger.error({ error }, 'Migration failed: 003_encrypt_existing_webhooks');
    throw error;
  }
};

/**
 * Rollback: This migration cannot be safely rolled back
 * Once data is encrypted, we should keep it encrypted
 */
export const down = async (_pool: Pool): Promise<void> => {
  logger.warn('Rollback not supported for 003_encrypt_existing_webhooks');
  logger.warn('Encrypted data should remain encrypted for security');
};
