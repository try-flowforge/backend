import { Request, Response } from 'express';
import { UserModel } from '../models/users';
import { CreateUserInput, ApiResponse } from '../types';
import { AppError } from '../middleware';

export class UserController {
  /**
   * Create a new user
   */
  static async createUser(req: Request, res: Response): Promise<void> {
    try {
      const userData: CreateUserInput = req.body;

      // Check if user already exists
      const existingUser = await UserModel.findById(userData.id);
      if (existingUser) {
        throw new AppError(409, 'User already exists', 'USER_EXISTS');
      }

      // Check if address is already used
      const existingAddress = await UserModel.findByAddress(userData.address);
      if (existingAddress) {
        throw new AppError(409, 'Address already in use', 'ADDRESS_EXISTS');
      }

      // Check if email is already used
      const existingEmail = await UserModel.findByEmail(userData.email);
      if (existingEmail) {
        throw new AppError(409, 'Email already in use', 'EMAIL_EXISTS');
      }

      const user = await UserModel.create(userData);

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
      if (!id) throw new AppError(400, 'Invalid id', 'INVALID_ID');

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
      if (!address) throw new AppError(400, 'Invalid address', 'INVALID_ADDRESS');

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
   * Delete a user
   */
  static async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) throw new AppError(400, 'Invalid id', 'INVALID_ID');

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
}
