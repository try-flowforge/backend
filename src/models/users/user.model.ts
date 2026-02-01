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
      RETURNING id, address, email, onboarded_at
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
      SELECT id, address, email, onboarded_at
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
      SELECT id, address, email, onboarded_at
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
      SELECT id, address, email, onboarded_at
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
      SELECT id, address, email, onboarded_at
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
}
