/**
 * Distributed Lock Service
 * Provides Redis-based distributed locking for preventing race conditions
 */

import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export interface LockResult {
    acquired: boolean;
    lockValue?: string;
    error?: string;
}

export interface LockOptions {
    /** Time-to-live for the lock in seconds (default: 60) */
    ttlSeconds?: number;
    /** Number of retry attempts (default: 0 = no retry) */
    retryAttempts?: number;
    /** Delay between retries in milliseconds (default: 100) */
    retryDelayMs?: number;
}

const DEFAULT_TTL_SECONDS = 60;
const DEFAULT_RETRY_ATTEMPTS = 0;
const DEFAULT_RETRY_DELAY_MS = 100;

/**
 * Acquire a distributed lock
 * Uses SET NX EX for atomic lock acquisition
 * 
 * @param key - Lock key (will be prefixed with "lock:")
 * @param options - Lock options
 * @returns LockResult with acquired status and lock value if successful
 */
export async function acquireLock(
    key: string,
    options: LockOptions = {}
): Promise<LockResult> {
    const {
        ttlSeconds = DEFAULT_TTL_SECONDS,
        retryAttempts = DEFAULT_RETRY_ATTEMPTS,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    } = options;

    const lockKey = `lock:${key}`;
    const lockValue = `${Date.now()}-${crypto.randomUUID()}`;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
            // SET NX EX - atomic "set if not exists" with expiration
            const result = await redisClient.set(lockKey, lockValue, {
                NX: true,
                EX: ttlSeconds,
            });

            if (result === 'OK') {
                logger.debug({ lockKey, lockValue, ttlSeconds }, 'Lock acquired');
                return { acquired: true, lockValue };
            }

            // Lock not acquired, maybe retry
            if (attempt < retryAttempts) {
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
        } catch (error) {
            logger.error(
                { error: error instanceof Error ? error.message : String(error), lockKey },
                'Failed to acquire lock'
            );
            return {
                acquired: false,
                error: 'Failed to acquire lock due to Redis error',
            };
        }
    }

    logger.debug({ lockKey }, 'Lock not acquired (already held)');
    return { acquired: false, error: 'Lock already held by another process' };
}

/**
 * Release a distributed lock
 * Uses Lua script for atomic check-and-delete to prevent releasing another process's lock
 * 
 * @param key - Lock key (will be prefixed with "lock:")
 * @param lockValue - The lock value returned from acquireLock
 * @returns true if lock was released, false otherwise
 */
export async function releaseLock(key: string, lockValue: string): Promise<boolean> {
    const lockKey = `lock:${key}`;

    // Lua script: only delete if we own the lock (value matches)
    const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        end
        return 0
    `;

    try {
        const result = await redisClient.eval(script, {
            keys: [lockKey],
            arguments: [lockValue],
        });

        const released = result === 1;
        if (released) {
            logger.debug({ lockKey }, 'Lock released');
        } else {
            logger.warn({ lockKey }, 'Lock not released (not owned or expired)');
        }
        return released;
    } catch (error) {
        logger.error(
            { error: error instanceof Error ? error.message : String(error), lockKey },
            'Failed to release lock'
        );
        return false;
    }
}

/**
 * Execute a function while holding a distributed lock
 * Automatically acquires and releases the lock
 * 
 * @param key - Lock key
 * @param fn - Function to execute while holding the lock
 * @param options - Lock options
 * @returns Result of the function, or null if lock couldn't be acquired
 */
export async function withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions = {}
): Promise<{ success: true; result: T } | { success: false; error: string }> {
    const lockResult = await acquireLock(key, options);

    if (!lockResult.acquired || !lockResult.lockValue) {
        return {
            success: false,
            error: lockResult.error || 'Could not acquire lock',
        };
    }

    try {
        const result = await fn();
        return { success: true, result };
    } finally {
        await releaseLock(key, lockResult.lockValue);
    }
}
