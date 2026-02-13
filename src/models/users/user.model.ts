import { query } from '../../config/database';
import { User, CreateUserInput } from '../../types';
import { logger } from '../../utils/logger';

export class UserModel {
  /**
   * Create a new user
   */
  static async create(userData: CreateUserInput): Promise<User> {
    const { id, address, email, onboarded_at } = userData;
    const onboardedDate = onboarded_at || new Date();

    const text = `
      INSERT INTO users (id, address, email, onboarded_at, safe_wallets)
      VALUES ($1, $2, $3, $4, '{}'::jsonb)
      RETURNING id, address, email, onboarded_at, safe_wallets, remaining_sponsored_txs
    `;
    const values = [id, address, email, onboardedDate];

    try {
      const result = await query(text, values);
      logger.info({ userId: id }, 'User created successfully');
      return result.rows[0];
    } catch (error: any) {
      if (error.code === '23505') {
        // Unique violation
        logger.warn({ userId: id }, 'User already exists');
        throw new Error('User with this ID, address, or email already exists');
      }
      logger.error({ error, userId: id }, 'Failed to create user');
      throw error;
    }
  }

  /**
   * Find a user by ID
   */
  static async findById(id: string): Promise<User | null> {
    const text = `
      SELECT id, address, email, onboarded_at, safe_wallets, remaining_sponsored_txs, selected_chains
      FROM users
      WHERE id = $1
    `;
    const values = [id];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      logger.error({ error, userId: id }, 'Failed to find user by ID');
      throw error;
    }
  }

  /**
   * Find a user by address
   */
  static async findByAddress(address: string): Promise<User | null> {
    const text = `
      SELECT id, address, email, onboarded_at, safe_wallets, remaining_sponsored_txs
      FROM users
      WHERE address = $1
    `;
    const values = [address];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      logger.error({ error, address }, 'Failed to find user by address');
      throw error;
    }
  }

  /**
   * Find a user by email
   */
  static async findByEmail(email: string): Promise<User | null> {
    const text = `
      SELECT id, address, email, onboarded_at, safe_wallets, remaining_sponsored_txs
      FROM users
      WHERE email = $1
    `;
    const values = [email];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      logger.error({ error, email }, 'Failed to find user by email');
      throw error;
    }
  }

  /**
   * Get all users with pagination
   */
  static async findAll(limit = 50, offset = 0): Promise<User[]> {
    const text = `
      SELECT id, address, email, onboarded_at, safe_wallets, remaining_sponsored_txs
      FROM users
      ORDER BY onboarded_at DESC
      LIMIT $1 OFFSET $2
    `;
    const values = [limit, offset];

    try {
      const result = await query(text, values);
      return result.rows;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch all users');
      throw error;
    }
  }


  /**
   * Delete a user
   */
  static async delete(id: string): Promise<boolean> {
    const text = `
      DELETE FROM users
      WHERE id = $1
      RETURNING id
    `;
    const values = [id];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        return false;
      }
      logger.info({ userId: id }, 'User deleted successfully');
      return true;
    } catch (error) {
      logger.error({ error, userId: id }, 'Failed to delete user');
      throw error;
    }
  }

  /**
   * Count total users
   */
  static async count(): Promise<number> {
    const text = 'SELECT COUNT(*) as count FROM users';

    try {
      const result = await query(text);
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error({ error }, 'Failed to count users');
      throw error;
    }
  }

  /**
   * Update Safe wallet address for a specific chain
   * Uses JSONB jsonb_set to update a specific key
   */
  static async updateSafeWallet(
    id: string,
    chainId: number | string,
    address: string
  ): Promise<User | null> {
    const text = `
      UPDATE users
      SET safe_wallets = jsonb_set(COALESCE(safe_wallets, '{}'::jsonb), ARRAY[$2::text], to_jsonb($3::text))
      WHERE id = $1
      RETURNING id, address, email, onboarded_at, safe_wallets
    `;
    // Cast chainId to string ensures it works as a key in JSON structure
    const values = [id, String(chainId), address];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        return null;
      }
      logger.info({ userId: id, chainId, address }, 'User Safe wallet updated');
      return result.rows[0];
    } catch (error) {
      logger.error({ error, userId: id }, 'Failed to update Safe wallet');
      throw error;
    }
  }

  /**
   * Find or create a user (useful for ensuring user exists)
   * Returns existing user if found, creates new one if not
   */
  static async findOrCreate(userData: CreateUserInput): Promise<User> {
    try {
      // Try to find existing user by ID
      const existingUser = await this.findById(userData.id);
      if (existingUser) {
        return existingUser;
      }

      // User doesn't exist, create it
      return await this.create(userData);
    } catch (error: any) {
      // If creation fails due to unique constraint (race condition), try to find again
      if (error.code === '23505') {
        const existingUser = await this.findById(userData.id);
        if (existingUser) {
          return existingUser;
        }
      }
      logger.error({ error, userId: userData.id }, 'Failed to find or create user');
      throw error;
    }
  }

  /**
   * Get Safe wallet address for a user based on chain
   * @param userId User ID
   * @param chainId Chain ID
   * @returns Safe wallet address or null if not found
   */
  static async getSafeAddressByChain(
    userId: string,
    chainId: number | string
  ): Promise<string | null> {
    const user = await this.findById(userId);
    if (!user || !user.safe_wallets) {
      return null;
    }

    return user.safe_wallets[String(chainId)] || null;
  }

  /**
   * Set remaining sponsored transactions for a user (e.g. after ENS subdomain registration).
   */
  static async setRemainingSponsoredTxs(
    userId: string,
    count: number
  ): Promise<User | null> {
    const text = `
      UPDATE users
      SET remaining_sponsored_txs = $1
      WHERE id = $2
      RETURNING id, address, email, onboarded_at, safe_wallets, remaining_sponsored_txs
    `;
    const values = [Math.max(0, count), userId];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) return null;
      logger.info({ userId, remaining_sponsored_txs: count }, 'Set remaining sponsored txs');
      return result.rows[0];
    } catch (error) {
      logger.error({ error, userId }, 'Failed to set remaining sponsored txs');
      throw error;
    }
  }

  /**
   * Consume one sponsored transaction for the user (atomic).
   * Used when the relayer pays gas for a user's Safe tx; limits to remaining_sponsored_txs.
   * @param userId User ID
   * @returns { consumed: true, remaining: number } if a slot was consumed, { consumed: false, remaining: number } otherwise
   */
  static async consumeOneSponsoredTx(userId: string): Promise<{
    consumed: boolean;
    remaining: number;
  }> {
    const text = `
      UPDATE users
      SET remaining_sponsored_txs = remaining_sponsored_txs - 1
      WHERE id = $1 AND remaining_sponsored_txs > 0
      RETURNING remaining_sponsored_txs
    `;
    const values = [userId];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        const user = await this.findById(userId);
        const remaining = user?.remaining_sponsored_txs ?? 0;
        return { consumed: false, remaining };
      }
      const remaining = Number(result.rows[0].remaining_sponsored_txs);
      logger.info({ userId, remaining }, 'Consumed one sponsored tx');
      return { consumed: true, remaining };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to consume sponsored tx');
      throw error;
    }
  }

  /**
   * Update selected chains for a user
   */
  static async updateSelectedChains(
    userId: string,
    chains: string[]
  ): Promise<User | null> {
    const text = `
      UPDATE users
      SET selected_chains = $1
      WHERE id = $2
      RETURNING id, address, email, onboarded_at, safe_wallets, remaining_sponsored_txs, selected_chains
    `;
    const values = [chains, userId];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) return null;
      logger.info({ userId, chains }, 'Updated selected chains');
      return result.rows[0];
    } catch (error) {
      logger.error({ error, userId }, 'Failed to update selected chains');
      throw error;
    }
  }
}

