/**
 * Subscription Token Service
 * Provides secure tokens for SSE subscription authentication
 */

import crypto from 'crypto';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { SSE_CONSTANTS } from '../config/constants';

const TOKEN_PREFIX = 'sseToken:';
const EXECUTION_TOKEN_PREFIX = 'execToken:';

export interface SubscriptionToken {
    token: string;
    executionId: string;
    userId: string;
    expiresAt: number;
}

/**
 * Generate a secure subscription token for SSE connections
 * Token is stored in Redis with the execution context
 * 
 * @param executionId - The workflow execution ID
 * @param userId - The user who owns this execution
 * @returns The generated token
 */
export async function generateSubscriptionToken(
    executionId: string,
    userId: string
): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const redisKey = `${TOKEN_PREFIX}${token}`;
    const expiresAt = Date.now() + SSE_CONSTANTS.SUBSCRIPTION_TOKEN_EXPIRY_MS;

    const tokenData: SubscriptionToken = {
        token,
        executionId,
        userId,
        expiresAt,
    };

    try {
        // Store token in Redis with expiry
        await redisClient.set(
            redisKey,
            JSON.stringify(tokenData),
            { PX: SSE_CONSTANTS.SUBSCRIPTION_TOKEN_EXPIRY_MS }
        );

        // Also store a reverse mapping for the execution ID
        // This allows us to invalidate tokens when execution completes
        const execKey = `${EXECUTION_TOKEN_PREFIX}${executionId}`;
        await redisClient.sAdd(execKey, token);
        await redisClient.pExpire(execKey, SSE_CONSTANTS.SUBSCRIPTION_TOKEN_EXPIRY_MS);

        logger.debug(
            { executionId, userId, expiresAt },
            'SSE subscription token generated'
        );

        return token;
    } catch (error) {
        logger.error(
            { error: error instanceof Error ? error.message : String(error), executionId },
            'Failed to generate subscription token'
        );
        throw error;
    }
}

/**
 * Verify a subscription token and return the associated data
 * 
 * @param executionId - The execution ID being accessed
 * @param token - The subscription token to verify
 * @returns True if token is valid for this execution
 */
export async function verifySubscriptionToken(
    executionId: string,
    token: string | undefined
): Promise<{ valid: boolean; userId?: string; error?: string }> {
    if (!token) {
        return { valid: false, error: 'Missing subscription token' };
    }

    const redisKey = `${TOKEN_PREFIX}${token}`;

    try {
        const data = await redisClient.get(redisKey);

        if (!data) {
            logger.warn({ executionId, tokenPrefix: token.substring(0, 8) }, 'SSE token not found');
            return { valid: false, error: 'Invalid or expired token' };
        }

        const tokenData: SubscriptionToken = JSON.parse(data);

        // Check if token is for this execution
        if (tokenData.executionId !== executionId) {
            logger.warn(
                {
                    executionId,
                    tokenExecutionId: tokenData.executionId,
                    tokenPrefix: token.substring(0, 8)
                },
                'SSE token execution mismatch'
            );
            return { valid: false, error: 'Token not valid for this execution' };
        }

        // Check expiry
        if (Date.now() > tokenData.expiresAt) {
            logger.warn({ executionId }, 'SSE token expired');
            return { valid: false, error: 'Token expired' };
        }

        logger.debug(
            { executionId, userId: tokenData.userId },
            'SSE subscription token verified'
        );

        return { valid: true, userId: tokenData.userId };
    } catch (error) {
        logger.error(
            { error: error instanceof Error ? error.message : String(error), executionId },
            'Failed to verify subscription token'
        );
        return { valid: false, error: 'Token verification failed' };
    }
}

/**
 * Invalidate all tokens for an execution
 * Called when execution completes or fails
 * 
 * @param executionId - The execution ID
 */
export async function invalidateExecutionTokens(executionId: string): Promise<void> {
    const execKey = `${EXECUTION_TOKEN_PREFIX}${executionId}`;

    try {
        // Get all tokens for this execution
        const tokens = await redisClient.sMembers(execKey);

        if (tokens.length > 0) {
            // Delete all token keys
            const tokenKeys = tokens.map(t => `${TOKEN_PREFIX}${t}`);
            await redisClient.del(tokenKeys);

            // Delete the execution token set
            await redisClient.del(execKey);

            logger.debug(
                { executionId, tokenCount: tokens.length },
                'SSE tokens invalidated for execution'
            );
        }
    } catch (error) {
        logger.error(
            { error: error instanceof Error ? error.message : String(error), executionId },
            'Failed to invalidate execution tokens'
        );
        // Don't throw - this is cleanup operation
    }
}

/**
 * Check if user has permission to subscribe to an execution
 * Queries the database to verify ownership
 * 
 * @param executionId - The execution ID
 * @param userId - The user ID to check
 */
export async function checkExecutionOwnership(
    executionId: string,
    userId: string
): Promise<boolean> {
    try {
        const { pool } = await import('../config/database');

        const result = await pool.query(
            'SELECT user_id FROM workflow_executions WHERE id = $1',
            [executionId]
        );

        if (result.rows.length === 0) {
            return false;
        }

        return result.rows[0].user_id === userId;
    } catch (error) {
        logger.error(
            { error: error instanceof Error ? error.message : String(error), executionId, userId },
            'Failed to check execution ownership'
        );
        return false;
    }
}
