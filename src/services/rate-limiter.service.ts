/**
 * Redis-based Rate Limiting Service
 * Provides distributed rate limiting that works across multiple server instances
 */

import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { RATE_LIMIT_CONSTANTS } from '../config/constants';

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfterMs?: number;
}

/**
 * Check if an action is allowed under rate limiting
 * Uses Redis for distributed state management
 * 
 * @param key - Unique identifier for the rate limit (e.g., "create-safe:userId")
 * @param maxRequests - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns RateLimitResult with allowed status and remaining quota
 */
export async function checkRateLimit(
    key: string,
    maxRequests: number = RATE_LIMIT_CONSTANTS.MAX_SAFE_CREATIONS_PER_DAY,
    windowMs: number = RATE_LIMIT_CONSTANTS.RATE_LIMIT_WINDOW_MS
): Promise<RateLimitResult> {
    const redisKey = `rateLimit:${key}`;
    const now = Date.now();

    try {
        // Use Redis transaction for atomic operations
        const multi = redisClient.multi();

        // Get current count
        multi.get(redisKey);
        // Get TTL
        multi.pTTL(redisKey);

        const results = await multi.exec();

        // Safely extract values from Redis multi result
        const countValue = results[0];
        const ttlValue = results[1];
        const currentCount = typeof countValue === 'string' ? parseInt(countValue, 10) || 0 : 0;
        const ttl = typeof ttlValue === 'number' ? ttlValue : -1;

        // Calculate reset time
        const resetTime = ttl > 0 ? now + ttl : now + windowMs;

        // Check if limit exceeded
        if (currentCount >= maxRequests) {
            logger.warn(
                { key, currentCount, maxRequests, ttl },
                'Rate limit exceeded'
            );

            return {
                allowed: false,
                remaining: 0,
                resetTime,
                retryAfterMs: ttl > 0 ? ttl : windowMs,
            };
        }

        // Increment counter
        const newCount = await redisClient.incr(redisKey);

        // Set expiry only on first request (when count becomes 1)
        if (newCount === 1) {
            await redisClient.pExpire(redisKey, windowMs);
        }

        const remaining = Math.max(0, maxRequests - newCount);

        logger.debug(
            { key, newCount, remaining, maxRequests },
            'Rate limit check passed'
        );

        return {
            allowed: true,
            remaining,
            resetTime,
        };
    } catch (error) {
        // If Redis fails, log error but allow the request
        // This prevents rate limiting from blocking all requests if Redis is down
        logger.error(
            { error: error instanceof Error ? error.message : String(error), key },
            'Rate limit check failed, allowing request'
        );

        return {
            allowed: true,
            remaining: maxRequests,
            resetTime: now + windowMs,
        };
    }
}

/**
 * Reset rate limit for a specific key
 * Useful for admin operations or testing
 * 
 * @param key - The rate limit key to reset
 */
export async function resetRateLimit(key: string): Promise<void> {
    const redisKey = `rateLimit:${key}`;

    try {
        await redisClient.del(redisKey);
        logger.info({ key }, 'Rate limit reset');
    } catch (error) {
        logger.error(
            { error: error instanceof Error ? error.message : String(error), key },
            'Failed to reset rate limit'
        );
        throw error;
    }
}

/**
 * Get current rate limit status for a key
 * 
 * @param key - The rate limit key to check
 * @param maxRequests - Maximum requests for calculating remaining
 * @returns Current rate limit status
 */
export async function getRateLimitStatus(
    key: string,
    maxRequests: number = RATE_LIMIT_CONSTANTS.MAX_SAFE_CREATIONS_PER_DAY
): Promise<{ count: number; remaining: number; ttlMs: number }> {
    const redisKey = `rateLimit:${key}`;

    try {
        const multi = redisClient.multi();
        multi.get(redisKey);
        multi.pTTL(redisKey);

        const results = await multi.exec();

        // Safely extract values from Redis multi result
        const countValue = results[0];
        const ttlValue = results[1];
        const count = typeof countValue === 'string' ? parseInt(countValue, 10) || 0 : 0;
        const ttlMs = typeof ttlValue === 'number' && ttlValue > 0 ? ttlValue : 0;

        return {
            count,
            remaining: Math.max(0, maxRequests - count),
            ttlMs,
        };
    } catch (error) {
        logger.error(
            { error: error instanceof Error ? error.message : String(error), key },
            'Failed to get rate limit status'
        );

        return {
            count: 0,
            remaining: maxRequests,
            ttlMs: 0,
        };
    }
}

/**
 * Sliding window rate limiter for more granular control
 * Uses sorted sets to track request timestamps
 * 
 * @param key - Unique identifier
 * @param maxRequests - Maximum requests in window
 * @param windowMs - Window size in milliseconds
 */
export async function checkSlidingWindowRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number
): Promise<RateLimitResult> {
    const redisKey = `slidingRateLimit:${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
        // Start transaction
        const multi = redisClient.multi();

        // Remove expired entries
        multi.zRemRangeByScore(redisKey, 0, windowStart);

        // Count current entries
        multi.zCard(redisKey);

        const results = await multi.exec();
        const countValue = results[1];
        const currentCount = typeof countValue === 'number' ? countValue : 0;

        if (currentCount >= maxRequests) {
            // Get oldest entry to calculate retry time
            const oldest = await redisClient.zRange(redisKey, 0, 0, { BY: 'SCORE' });
            const retryAfterMs = oldest.length > 0
                ? parseInt(oldest[0], 10) + windowMs - now
                : windowMs;

            return {
                allowed: false,
                remaining: 0,
                resetTime: now + retryAfterMs,
                retryAfterMs,
            };
        }

        // Add current request
        await redisClient.zAdd(redisKey, { score: now, value: now.toString() });

        // Set expiry on the key
        await redisClient.pExpire(redisKey, windowMs);

        return {
            allowed: true,
            remaining: maxRequests - currentCount - 1,
            resetTime: now + windowMs,
        };
    } catch (error) {
        logger.error(
            { error: error instanceof Error ? error.message : String(error), key },
            'Sliding window rate limit check failed'
        );

        return {
            allowed: true,
            remaining: maxRequests,
            resetTime: now + windowMs,
        };
    }
}
