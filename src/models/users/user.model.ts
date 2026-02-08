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
      INSERT INTO users (id, address, email, onboarded_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id, address, email, onboarded_at, safe_wallet_address_testnet, safe_wallet_address_mainnet, safe_wallet_address_eth_sepolia, remaining_sponsored_txs
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
      SELECT id, address, email, onboarded_at, safe_wallet_address_testnet, safe_wallet_address_mainnet, safe_wallet_address_eth_sepolia, remaining_sponsored_txs
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
      SELECT id, address, email, onboarded_at, safe_wallet_address_testnet, safe_wallet_address_mainnet, safe_wallet_address_eth_sepolia, remaining_sponsored_txs
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
      SELECT id, address, email, onboarded_at, safe_wallet_address_testnet, safe_wallet_address_mainnet, safe_wallet_address_eth_sepolia, remaining_sponsored_txs
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
      SELECT id, address, email, onboarded_at, safe_wallet_address_testnet, safe_wallet_address_mainnet, safe_wallet_address_eth_sepolia, remaining_sponsored_txs
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
   * Update user's Safe wallet addresses
   */
  static async updateSafeWalletAddresses(
    id: string,
    testnetAddress?: string,
    mainnetAddress?: string,
    ethSepoliaAddress?: string
  ): Promise<User | null> {
    const updates: string[] = [];
    const values: (string | undefined)[] = [];
    let paramIndex = 1;

    if (testnetAddress !== undefined) {
      updates.push(`safe_wallet_address_testnet = $${paramIndex}`);
      values.push(testnetAddress);
      paramIndex++;
    }

    if (mainnetAddress !== undefined) {
      updates.push(`safe_wallet_address_mainnet = $${paramIndex}`);
      values.push(mainnetAddress);
      paramIndex++;
    }

    if (ethSepoliaAddress !== undefined) {
      updates.push(`safe_wallet_address_eth_sepolia = $${paramIndex}`);
      values.push(ethSepoliaAddress);
      paramIndex++;
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);

    const text = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, address, email, onboarded_at, safe_wallet_address_testnet, safe_wallet_address_mainnet, safe_wallet_address_eth_sepolia
    `;

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        return null;
      }
      logger.info({ userId: id }, 'User Safe wallet addresses updated');
      return result.rows[0];
    } catch (error) {
      logger.error({ error, userId: id }, 'Failed to update Safe wallet addresses');
      throw error;
    }
  }

  /**
   * Update Safe wallet address for a specific chain
   * @param id User ID
   * @param chainId 421614 (Arbitrum Sepolia), 42161 (Arbitrum Mainnet), 11155111 (Ethereum Sepolia)
   * @param address Safe wallet address
   */
  static async updateSafeAddressForChain(
    id: string,
    chainId: number,
    address: string
  ): Promise<User | null> {
    const column =
      chainId === 421614
        ? 'safe_wallet_address_testnet'
        : chainId === 42161
          ? 'safe_wallet_address_mainnet'
          : chainId === 11155111
            ? 'safe_wallet_address_eth_sepolia'
            : null;

    if (!column) {
      logger.warn({ userId: id, chainId }, 'Unsupported chain ID for Safe address update');
      return null;
    }

    const text = `
      UPDATE users
      SET ${column} = $1
      WHERE id = $2
      RETURNING id, address, email, onboarded_at, safe_wallet_address_testnet, safe_wallet_address_mainnet, safe_wallet_address_eth_sepolia
    `;

    try {
      const result = await query(text, [address, id]);
      if (result.rows.length === 0) {
        return null;
      }
      logger.info({ userId: id, chainId }, 'User Safe wallet address updated for chain');
      return result.rows[0];
    } catch (error) {
      logger.error({ error, userId: id, chainId }, 'Failed to update Safe wallet address for chain');
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
   * @param chainId Chain ID (421614 Arbitrum Sepolia, 42161 Arbitrum Mainnet, 11155111 Ethereum Sepolia)
   * @returns Safe wallet address or null if not found
   */
  static async getSafeAddressByChain(
    userId: string,
    chainId: number
  ): Promise<string | null> {
    const user = await this.findById(userId);
    if (!user) {
      return null;
    }

    if (chainId === 421614) {
      return user.safe_wallet_address_testnet || null;
    }
    if (chainId === 42161) {
      return user.safe_wallet_address_mainnet || null;
    }
    if (chainId === 11155111) {
      return user.safe_wallet_address_eth_sepolia || null;
    }

    logger.warn({ userId, chainId }, 'Unsupported chain ID for Safe address lookup');
    return null;
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
      RETURNING id, address, email, onboarded_at, safe_wallet_address_testnet, safe_wallet_address_mainnet, safe_wallet_address_eth_sepolia, remaining_sponsored_txs
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
}

