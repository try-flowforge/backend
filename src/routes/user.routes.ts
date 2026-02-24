import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import {
  getMeAgentContext,
  patchMeAgentContext,
} from '../controllers/agent-context.controller';
import { validateBody, validateParams, asyncHandler } from '../middleware';
import { verifyPrivyToken } from '../middleware/privy-auth';
import { createUserSchema, userIdSchema, updateUserChainsSchema } from '../models/users';

const router = Router();

/**
 * @route   PUT /api/v1/users/chains
 * @desc    Update selected chains for authenticated user
 * @access  Private (requires Privy token)
 */
router.put(
  '/chains',
  verifyPrivyToken,
  validateBody(updateUserChainsSchema),
  asyncHandler(UserController.updateSelectedChains)
);

/**
 * @route   POST /api/v1/users
 * @desc    Create a new user
 * @access  Public
 */
router.post(
  '/',
  validateBody(createUserSchema),
  asyncHandler(UserController.createUser)
);

/**
 * @route   GET /api/v1/users
 * @desc    Get all users with pagination
 * @access  Public
 */
router.get('/', asyncHandler(UserController.getAllUsers));

/**
 * @route   GET /api/v1/users/me
 * @desc    Get current authenticated user
 * @access  Private (requires Privy token)
 * @important Must be defined BEFORE /:id route to avoid matching "me" as an ID
 */
router.get('/me', verifyPrivyToken, asyncHandler(UserController.getMe));

/**
 * @route   GET /api/v1/users/me/agent-context
 * @desc    Get current user's agent context (for planner)
 * @access  Private (requires Privy token)
 */
router.get(
  '/me/agent-context',
  verifyPrivyToken,
  asyncHandler(getMeAgentContext)
);

/**
 * @route   PATCH /api/v1/users/me/agent-context
 * @desc    Update current user's agent context (allowlisted keys only)
 * @access  Private (requires Privy token)
 */
router.patch(
  '/me/agent-context',
  verifyPrivyToken,
  asyncHandler(patchMeAgentContext)
);

/**
 * @route   GET /api/v1/users/:id
 * @desc    Get user by ID
 * @access  Public
 */
router.get(
  '/:id',
  validateParams(userIdSchema),
  asyncHandler(UserController.getUserById)
);

/**
 * @route   GET /api/v1/users/address/:address
 * @desc    Get user by address
 * @access  Public
 */
router.get('/address/:address', asyncHandler(UserController.getUserByAddress));

/**
 * @route   DELETE /api/v1/users/:id
 * @desc    Delete user
 * @access  Public
 */
router.delete(
  '/:id',
  validateParams(userIdSchema),
  asyncHandler(UserController.deleteUser)
);

export default router;

