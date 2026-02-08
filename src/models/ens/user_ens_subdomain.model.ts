import { query } from '../../config/database';
import { logger } from '../../utils/logger';

export interface UserEnsSubdomain {
  id: string;
  user_id: string;
  ens_name: string;
  owner_address: string;
  expiry: Date;
  chain_id: number;
  created_at: Date;
}

export interface CreateUserEnsSubdomainInput {
  userId: string;
  ensName: string;
  ownerAddress: string;
  expiry: Date;
  chainId: number;
}

export class UserEnsSubdomainModel {
  /**
   * Insert or update a subdomain registration (upsert by ens_name).
   * On conflict, update user_id, owner_address, expiry, chain_id.
   */
  static async upsert(input: CreateUserEnsSubdomainInput): Promise<UserEnsSubdomain> {
    const { userId, ensName, ownerAddress, expiry, chainId } = input;

    const text = `
      INSERT INTO user_ens_subdomains (user_id, ens_name, owner_address, expiry, chain_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (ens_name)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        owner_address = EXCLUDED.owner_address,
        expiry = EXCLUDED.expiry,
        chain_id = EXCLUDED.chain_id
      RETURNING *
    `;
    const values = [userId, ensName, ownerAddress, expiry, chainId];

    try {
      const result = await query(text, values);
      logger.info({ userId, ensName }, 'User ENS subdomain upserted');
      return result.rows[0];
    } catch (error) {
      logger.error({ error, userId, ensName }, 'Failed to upsert user ENS subdomain');
      throw error;
    }
  }

  /**
   * Get all subdomains for a user.
   */
  static async findByUserId(userId: string): Promise<UserEnsSubdomain[]> {
    const text = `
      SELECT * FROM user_ens_subdomains
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const values = [userId];

    try {
      const result = await query(text, values);
      return result.rows;
    } catch (error) {
      logger.error({ error, userId }, 'Failed to find user ENS subdomains');
      throw error;
    }
  }

  /**
   * Get active subdomains for a user (expiry > now).
   */
  static async getActiveByUserId(userId: string): Promise<UserEnsSubdomain[]> {
    const text = `
      SELECT * FROM user_ens_subdomains
      WHERE user_id = $1 AND expiry > NOW()
      ORDER BY expiry DESC
    `;
    const values = [userId];

    try {
      const result = await query(text, values);
      return result.rows;
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get active ENS subdomains');
      throw error;
    }
  }

  /**
   * Find by ENS name.
   */
  static async findByEnsName(ensName: string): Promise<UserEnsSubdomain | null> {
    const text = `SELECT * FROM user_ens_subdomains WHERE ens_name = $1`;
    const values = [ensName];

    try {
      const result = await query(text, values);
      return result.rows[0] || null;
    } catch (error) {
      logger.error({ error, ensName }, 'Failed to find ENS subdomain by name');
      throw error;
    }
  }
}
