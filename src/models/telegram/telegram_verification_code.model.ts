import { query } from '../../config/database';
import { logger } from '../../utils/logger';
import crypto from 'crypto';

export type VerificationCodeStatus = 'pending' | 'verified' | 'expired';

export interface TelegramVerificationCode {
    id: string;
    user_id: string;
    code: string;
    status: VerificationCodeStatus;
    chat_id: string | null;
    chat_title: string | null;
    chat_type: string | null;
    created_at: Date;
    expires_at: Date;
    verified_at: Date | null;
}

// Code expiry time in minutes
const CODE_EXPIRY_MINUTES = 10;

// Active codes cache to ensure uniqueness during generation
// Maps code -> expiry timestamp
const activeCodesCache = new Map<string, number>();

/**
 * Generate a unique, cryptographically secure verification code
 * Format: verify-XXXXXX (6 alphanumeric characters)
 */
function generateUniqueCode(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const length = 6;
    let code: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
        const randomBytes = crypto.randomBytes(length);
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars[randomBytes[i] % chars.length];
        }
        code = `verify-${result}`;
        attempts++;
    } while (activeCodesCache.has(code) && attempts < maxAttempts);

    if (attempts >= maxAttempts) {
        // Fallback to longer code if collision persists
        code = `verify-${crypto.randomBytes(8).toString('hex').substring(0, 8)}`;
    }

    return code;
}

/**
 * Clean up expired codes from cache
 */
function cleanupExpiredFromCache(): void {
    const now = Date.now();
    for (const [code, expiresAt] of activeCodesCache.entries()) {
        if (expiresAt < now) {
            activeCodesCache.delete(code);
        }
    }
}

export class TelegramVerificationCodeModel {
    /**
     * Generate a new verification code for a user
     * Returns existing pending code if one exists and is still valid
     */
    static async generateCode(userId: string): Promise<TelegramVerificationCode> {
        // Clean up expired codes from cache
        cleanupExpiredFromCache();

        // Check if user already has an active pending code
        const existingCode = await this.findPendingByUserId(userId);
        if (existingCode) {
            logger.info({ userId, code: existingCode.code }, 'Returning existing pending verification code');
            return existingCode;
        }

        // Generate a unique code
        const code = generateUniqueCode();
        const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

        // Add to cache immediately to prevent race conditions
        activeCodesCache.set(code, expiresAt.getTime());

        const text = `
            INSERT INTO telegram_verification_codes 
            (user_id, code, status, expires_at)
            VALUES ($1, $2, 'pending', $3)
            RETURNING *
        `;
        const values = [userId, code, expiresAt];

        try {
            const result = await query(text, values);
            logger.info({ userId, code }, 'Verification code generated');
            return result.rows[0];
        } catch (error) {
            // Remove from cache if DB insert failed
            activeCodesCache.delete(code);
            logger.error({ error, userId }, 'Failed to generate verification code');
            throw error;
        }
    }

    /**
     * Find a pending (not verified, not expired) code by user ID
     */
    static async findPendingByUserId(userId: string): Promise<TelegramVerificationCode | null> {
        const text = `
            SELECT * FROM telegram_verification_codes
            WHERE user_id = $1 
            AND status = 'pending' 
            AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1
        `;
        const values = [userId];

        try {
            const result = await query(text, values);
            return result.rows[0] || null;
        } catch (error) {
            logger.error({ error, userId }, 'Failed to find pending verification code');
            throw error;
        }
    }

    /**
     * Find a code by its value (only pending and not expired)
     */
    static async findByCode(code: string): Promise<TelegramVerificationCode | null> {
        const text = `
            SELECT * FROM telegram_verification_codes
            WHERE code = $1 
            AND status = 'pending' 
            AND expires_at > NOW()
        `;
        const values = [code];

        try {
            const result = await query(text, values);
            return result.rows[0] || null;
        } catch (error) {
            logger.error({ error, code }, 'Failed to find verification code');
            throw error;
        }
    }

    /**
     * Verify a code - mark it as verified and store chat info
     * This is a one-time operation - once verified, the code cannot be used again
     */
    static async verifyCode(
        code: string,
        chatId: string,
        chatTitle: string,
        chatType: string
    ): Promise<TelegramVerificationCode | null> {
        // Use UPDATE with WHERE status = 'pending' to ensure atomicity
        // If another request already verified it, this will return 0 rows
        const text = `
            UPDATE telegram_verification_codes
            SET 
                status = 'verified',
                chat_id = $2,
                chat_title = $3,
                chat_type = $4,
                verified_at = NOW()
            WHERE code = $1 
            AND status = 'pending' 
            AND expires_at > NOW()
            RETURNING *
        `;
        const values = [code, chatId, chatTitle, chatType];

        try {
            const result = await query(text, values);

            if (result.rows.length > 0) {
                // Remove from active codes cache
                activeCodesCache.delete(code);
                logger.info({ code, chatId, chatTitle }, 'Verification code verified successfully');
                return result.rows[0];
            }

            // Code was already verified, expired, or doesn't exist
            logger.warn({ code }, 'Verification code not found or already used');
            return null;
        } catch (error) {
            logger.error({ error, code }, 'Failed to verify code');
            throw error;
        }
    }

    /**
     * Get verification status for a user's most recent code
     */
    static async getLatestCodeStatus(userId: string): Promise<TelegramVerificationCode | null> {
        const text = `
            SELECT * FROM telegram_verification_codes
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        `;
        const values = [userId];

        try {
            const result = await query(text, values);
            return result.rows[0] || null;
        } catch (error) {
            logger.error({ error, userId }, 'Failed to get latest code status');
            throw error;
        }
    }

    /**
     * Mark expired codes as expired in the database
     * Should be called periodically (e.g., by a cron job)
     */
    static async cleanupExpiredCodes(): Promise<number> {
        const text = `
            UPDATE telegram_verification_codes
            SET status = 'expired'
            WHERE status = 'pending' AND expires_at < NOW()
            RETURNING id
        `;

        try {
            const result = await query(text);
            const count = result.rows.length;
            if (count > 0) {
                logger.info({ count }, 'Expired verification codes cleaned up');
            }
            return count;
        } catch (error) {
            logger.error({ error }, 'Failed to cleanup expired codes');
            throw error;
        }
    }

    /**
     * Cancel a pending code (user can cancel and regenerate)
     */
    static async cancelCode(codeId: string, userId: string): Promise<boolean> {
        const text = `
            UPDATE telegram_verification_codes
            SET status = 'expired'
            WHERE id = $1 AND user_id = $2 AND status = 'pending'
            RETURNING id
        `;
        const values = [codeId, userId];

        try {
            const result = await query(text, values);
            return result.rows.length > 0;
        } catch (error) {
            logger.error({ error, codeId, userId }, 'Failed to cancel verification code');
            throw error;
        }
    }
}
