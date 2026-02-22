import { Request, Response } from 'express';
import { UserModel } from '../models/users';
import { CreateUserInput, ApiResponse } from '../types';
import { AppError } from '../middleware';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import { SafeWalletService } from '../services/safe-wallet.service';
import { logger } from '../utils/logger';
import { NUMERIC_CHAIN_IDS } from '../config/chain-registry';
import { PrivyClient } from '@privy-io/server-auth';
import { config } from '../config/config';

export class UserController {
  /**
   * Create a new user
   * Also auto-provisions Safe wallets on both testnet and mainnet
   */
  static async createUser(req: Request, res: Response): Promise<void> {
    try {
      const userData: CreateUserInput = req.body;

      // Check if user already exists
      const existingUser = await UserModel.findById(userData.id);
      if (existingUser) {
        throw new AppError(409, 'User already exists', 'USER_EXISTS');
      }

      // Check if address is already used (only when address provided)
      if (userData.address) {
        const existingAddress = await UserModel.findByAddress(userData.address);
        if (existingAddress) {
          throw new AppError(409, 'Address already in use', 'ADDRESS_EXISTS');
        }
      }

      // Check if email is already used
      const existingEmail = await UserModel.findByEmail(userData.email);
      if (existingEmail) {
        throw new AppError(409, 'Email already in use', 'EMAIL_EXISTS');
      }

      // Create user first
      let user = await UserModel.create(userData);

      // Auto-provision Safe wallets on both chains (only when address is present)
      // This is done asynchronously and errors are logged but not thrown
      // Missing wallets can be created later via the relay endpoint
      if (userData.address) {
        try {
          logger.info({ userId: user.id, userAddress: userData.address }, 'Auto-provisioning Safe wallets');

          const safeResults = await SafeWalletService.createSafesForUserOnAllChains(userData.address);

        // Update user with wallet addresses
        // Iterate through all results and update individually
        for (const [key, result] of Object.entries(safeResults)) {
          if (result && result.success && result.safeAddress) {
            // Map key to chainId
            let chainId: number | undefined;
            if (key === 'testnet') chainId = NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA;
            else if (key === 'mainnet') chainId = NUMERIC_CHAIN_IDS.ARBITRUM;
            else if (key === 'ethSepolia') chainId = NUMERIC_CHAIN_IDS.ETHEREUM_SEPOLIA;

            if (chainId) {
              const updatedUser = await UserModel.updateSafeWallet(user.id, chainId, result.safeAddress);
              if (updatedUser) {
                user = updatedUser;
              }
            }
          }
        }

        logger.info(
          {
            userId: user.id,
            testnet: safeResults.testnet?.success ? 'success' : 'failed',
            mainnet: safeResults.mainnet?.success ? 'success' : 'failed',
            ethSepolia: safeResults.ethSepolia?.success ? 'success' : 'failed',
          },
          'Safe wallet provisioning completed'
        );
      } catch (safeError) {
        // Log error but don't fail user creation
        logger.error(
          {
            error: safeError instanceof Error ? safeError.message : String(safeError),
            userId: user.id,
          },
          'Failed to auto-provision Safe wallets, user created without wallets'
        );
      }
      }

      const response: ApiResponse = {
        success: true,
        data: user,
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(201).json(response);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get a user by ID
   */
  static async getUserById(req: Request, res: Response): Promise<void> {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        throw new AppError(400, 'Invalid id', 'BAD_REQUEST');
      }

      const user = await UserModel.findById(id);

      if (!user) {
        throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const response: ApiResponse = {
        success: true,
        data: user,
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get a user by address
   */
  static async getUserByAddress(req: Request, res: Response): Promise<void> {
    try {
      const address = Array.isArray(req.params.address) ? req.params.address[0] : req.params.address;
      if (!address) {
        throw new AppError(400, 'Invalid address', 'BAD_REQUEST');
      }

      const user = await UserModel.findByAddress(address);

      if (!user) {
        throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const response: ApiResponse = {
        success: true,
        data: user,
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all users with pagination
   */
  static async getAllUsers(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const users = await UserModel.findAll(limit, offset);
      const total = await UserModel.count();

      const response: ApiResponse = {
        success: true,
        data: {
          users,
          pagination: {
            limit,
            offset,
            total,
            hasMore: offset + limit < total,
          },
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get current authenticated user (via Privy token)
   * This is safer than GET /users/address/:address as it uses authenticated userId
   */
  static async getMe(req: Request, res: Response): Promise<void> {
    try {
      // This requires AuthenticatedRequest from privy-auth middleware
      const userId = (req as any).userId;

      if (!userId) {
        throw new AppError(401, 'Not authenticated', 'NOT_AUTHENTICATED');
      }

      const user = await UserModel.findById(userId);

      // If user not found (new user), return success with null data
      // This allows frontend to detect new user state without 404 errors
      if (!user) {
        res.status(200).json({
          success: true,
          data: null,
          meta: {
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: user,
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === '42703' && typeof err?.message === 'string' && err.message.includes('safe_wallets')) {
        throw new AppError(
          503,
          'Database schema outdated: missing safe_wallets column. Run migrations in backend: npm run migrate:up',
          'SCHEMA_OUTDATED'
        );
      }
      throw error;
    }
  }

  /**
   * Delete a user
   */
  static async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        throw new AppError(400, 'Invalid id', 'BAD_REQUEST');
      }

      const deleted = await UserModel.delete(id);

      if (!deleted) {
        throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const response: ApiResponse = {
        success: true,
        data: {
          message: 'User deleted successfully',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      throw error;
    }
  }
  /**
   * Ensure user exists for onboarding (e.g. email-only or first request).
   * Creates user via findOrCreate with Privy email when missing.
   */
  static async ensureUserForOnboarding(
    userId: string,
    walletAddress: string
  ): Promise<void> {
    const existing = await UserModel.findById(userId);
    if (existing) return;

    let email = `${userId}@privy.local`;
    try {
      const privyClient = new PrivyClient(config.privy.appId, config.privy.appSecret);
      const privyUser = await privyClient.getUser(userId);
      const emailAccount = privyUser.linkedAccounts?.find(
        (account) => account.type === 'email'
      );
      if (emailAccount && 'address' in emailAccount) {
        email = emailAccount.address;
      }
    } catch (privyError) {
      logger.warn({ privyError, userId }, 'Could not fetch email from Privy, using fallback');
    }

    const address = walletAddress && walletAddress.trim() !== '' ? walletAddress : undefined;
    await UserModel.findOrCreate({
      id: userId,
      address,
      email,
      onboarded_at: new Date(),
    });
    logger.info({ userId, hasAddress: !!address }, 'User created for onboarding');
  }

  /**
   * Update selected chains for a user
   */
  static async updateSelectedChains(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.userId;
      const walletAddress = authReq.userWalletAddress ?? '';
      const { chains } = req.body;

      if (!userId) {
        throw new AppError(401, 'Not authenticated', 'NOT_AUTHENTICATED');
      }

      let user = await UserModel.findById(userId);
      if (!user) {
        await UserController.ensureUserForOnboarding(userId, walletAddress);
        user = await UserModel.findById(userId);
        if (!user) {
          throw new AppError(500, 'Failed to create user for onboarding', 'USER_CREATE_FAILED');
        }
      }

      const updatedUser = await UserModel.updateSelectedChains(userId, chains);

      const response: ApiResponse = {
        success: true,
        data: updatedUser,
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      throw error;
    }
  }
}

