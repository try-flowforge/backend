import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import { TelegramConnectionModel, TelegramVerificationCodeModel } from '../models/telegram';
import { UserModel } from '../models/users';
import { AppError } from '../middleware/error-handler';
import { logger } from '../utils/logger';
import { PrivyClient } from '@privy-io/server-auth';
import { config } from '../config/config';

// Centralized bot token from environment
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

interface TelegramApiResponse {
    ok: boolean;
    result?: unknown;
    description?: string;
}

interface TelegramChat {
    id: number | string;
    title?: string;
    username?: string;
    first_name?: string;
    type: 'private' | 'group' | 'supergroup' | 'channel';
}

/**
 * Helper to call Telegram Bot API using centralized token
 */
async function callTelegramApi<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    if (!TELEGRAM_BOT_TOKEN) {
        throw new AppError(500, 'Telegram bot token not configured', 'TELEGRAM_NOT_CONFIGURED');
    }

    const url = `${TELEGRAM_API_BASE}${TELEGRAM_BOT_TOKEN}/${method}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json() as TelegramApiResponse;

    if (!data.ok) {
        logger.error({ method, error: data.description }, 'Telegram API error');
        throw new AppError(
            response.status === 429 ? 429 : 400,
            data.description || 'Telegram API error',
            'TELEGRAM_API_ERROR'
        );
    }

    return data.result as T;
}

/**
 * Get central bot info
 * GET /api/v1/integrations/telegram/bot
 */
export const getBotInfo = async (
    _req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        if (!TELEGRAM_BOT_TOKEN) {
            throw new AppError(500, 'Telegram bot not configured', 'TELEGRAM_NOT_CONFIGURED');
        }

        const botInfo = await callTelegramApi<{
            id: number;
            first_name: string;
            username: string;
            can_join_groups: boolean;
            can_read_all_group_messages: boolean;
        }>('getMe');

        res.json({
            success: true,
            data: {
                id: botInfo.id,
                name: botInfo.first_name,
                username: botInfo.username,
                canJoinGroups: botInfo.can_join_groups,
                canReadAllMessages: botInfo.can_read_all_group_messages,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Helper to check if bot still has access to a chat
 */
async function verifyChatAccess(chatId: string): Promise<TelegramChat | null> {
    if (!TELEGRAM_BOT_TOKEN) return null;

    try {
        const url = `${TELEGRAM_API_BASE}${TELEGRAM_BOT_TOKEN}/getChat`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId }),
        });

        const data = await response.json() as TelegramApiResponse;

        if (data.ok && data.result) {
            return data.result as TelegramChat;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Get available chats where the bot has been added
 * GET /api/v1/integrations/telegram/chats
 *
 * Chats are discovered by the agent service (which receives all Telegram updates via webhook)
 * and forwarded to the backend via POST /ingest. This endpoint returns those discovered chats.
 * No getUpdates fallback: the agent is the single receiver for Telegram updates.
 */
export const getAvailableChats = async (
    _req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { getDiscoveredChats } = await import('./telegram-webhook.controller');
        const webhookChats = getDiscoveredChats();

        if (webhookChats.length === 0) {
            res.json({
                success: true,
                data: {
                    chats: [],
                    source: 'none',
                    message: 'No chats discovered yet. Add the bot to a chat/channel, send a message (or use /plan in the agent), then refresh. The agent service receives updates and forwards them here.',
                },
            });
            return;
        }

        const verificationPromises = webhookChats.map(async (chat) => {
            const verifiedChat = await verifyChatAccess(chat.id);
            if (verifiedChat) {
                return {
                    id: chat.id,
                    title: chat.title,
                    username: chat.username,
                    type: chat.type,
                };
            }
            return null;
        });

        const results = await Promise.all(verificationPromises);
        const verifiedChats = results.filter((r): r is NonNullable<typeof r> => r !== null);

        res.json({
            success: true,
            data: {
                chats: verifiedChats,
                source: 'agent',
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get user's saved connections
 * GET /api/v1/integrations/telegram/connections
 */
export const getConnections = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
        }

        const connections = await TelegramConnectionModel.findByUserId(userId);

        res.json({
            success: true,
            data: {
                connections: connections.map((conn) => ({
                    id: conn.id,
                    name: conn.name,
                    chatId: conn.chat_id,
                    chatTitle: conn.chat_title,
                    chatType: conn.chat_type,
                    createdAt: conn.created_at,
                })),
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Ensure user exists in database (create if not exists)
 * Throws an error if user cannot be created
 */
async function ensureUserExists(userId: string, walletAddress: string): Promise<void> {
    try {
        // Check if user already exists
        const existingUser = await UserModel.findById(userId);
        if (existingUser) {
            return; // User already exists
        }

        logger.info({ userId, walletAddress }, 'User not found, attempting to create...');

        // User doesn't exist, need to fetch email from Privy
        const privyClient = new PrivyClient(config.privy.appId, config.privy.appSecret);

        let email = `${userId}@privy.local`; // Default fallback email

        try {
            const privyUser = await privyClient.getUser(userId);
            // Get email from Privy user
            const emailAccount = privyUser.linkedAccounts?.find(
                (account) => account.type === 'email'
            );
            if (emailAccount && 'address' in emailAccount) {
                email = emailAccount.address;
            }
        } catch (privyError) {
            logger.warn({ privyError, userId }, 'Could not fetch user from Privy, using fallback email');
        }

        // Create user in database
        const createdUser = await UserModel.findOrCreate({
            id: userId,
            address: walletAddress,
            email: email,
            onboarded_at: new Date(),
        });

        if (!createdUser) {
            throw new Error('Failed to create user in database');
        }

        logger.info({ userId, email }, 'User created/ensured in database');
    } catch (error) {
        logger.error({ error, userId, walletAddress }, 'Failed to ensure user exists');
        throw new AppError(
            500,
            'Failed to create user account. Please try logging out and back in.',
            'USER_CREATION_FAILED'
        );
    }
}

/**
 * Save a chat as a connection
 * POST /api/v1/integrations/telegram/connections
 */
export const createConnection = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.userId;
        const walletAddress = req.userWalletAddress;
        if (!userId || !walletAddress) {
            throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
        }

        // Ensure user exists in database before creating connection
        await ensureUserExists(userId, walletAddress);

        const { chatId, chatTitle, chatType, name } = req.body;

        const connection = await TelegramConnectionModel.upsert({
            userId,
            chatId,
            chatTitle,
            chatType,
            name,
        });

        res.status(201).json({
            success: true,
            data: {
                connection: {
                    id: connection.id,
                    name: connection.name,
                    chatId: connection.chat_id,
                    chatTitle: connection.chat_title,
                    chatType: connection.chat_type,
                    createdAt: connection.created_at,
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete a connection
 * DELETE /api/v1/integrations/telegram/connections/:connectionId
 */
export const deleteConnection = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
        }

        const connectionId = Array.isArray(req.params.connectionId)
            ? req.params.connectionId[0]
            : req.params.connectionId;
        if (!connectionId) {
            throw new AppError(400, 'Invalid connectionId', 'BAD_REQUEST');
        }
        const deleted = await TelegramConnectionModel.delete(connectionId, userId);

        if (!deleted) {
            throw new AppError(404, 'Connection not found', 'CONNECTION_NOT_FOUND');
        }

        res.json({
            success: true,
            message: 'Connection deleted successfully',
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Send a message via Telegram
 * POST /api/v1/integrations/telegram/send
 */
export const sendMessage = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
        }

        const { connectionId, text, parseMode } = req.body;

        // Verify user owns this connection
        const connection = await TelegramConnectionModel.findByIdAndUser(connectionId, userId);
        if (!connection) {
            throw new AppError(404, 'Connection not found', 'CONNECTION_NOT_FOUND');
        }

        // Send message using central bot
        const result = await callTelegramApi<{ message_id: number }>('sendMessage', {
            chat_id: connection.chat_id,
            text,
            parse_mode: parseMode,
        });

        logger.info(
            { userId, connectionId, chatId: connection.chat_id, messageId: result.message_id },
            'Telegram message sent'
        );

        res.json({
            success: true,
            data: {
                messageId: result.message_id,
                chatId: connection.chat_id,
                chatTitle: connection.chat_title,
            },
        });
    } catch (error) {
        next(error);
    }
};

// ============================================
// VERIFICATION CODE ENDPOINTS
// ============================================

/**
 * Generate a verification code for adding a new chat
 * POST /api/v1/integrations/telegram/verification/generate
 * 
 * Returns an existing pending code if one exists (prevents duplicate codes)
 */
export const generateVerificationCode = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.userId;
        const walletAddress = req.userWalletAddress;
        if (!userId || !walletAddress) {
            throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
        }

        // Ensure user exists in database
        await ensureUserExists(userId, walletAddress);

        // Generate or retrieve existing code
        const codeRecord = await TelegramVerificationCodeModel.generateCode(userId);

        // Calculate remaining time
        const expiresAt = new Date(codeRecord.expires_at);
        const remainingMs = expiresAt.getTime() - Date.now();
        const remainingMinutes = Math.ceil(remainingMs / 60000);

        res.json({
            success: true,
            data: {
                code: codeRecord.code,
                expiresAt: codeRecord.expires_at,
                remainingMinutes,
                status: codeRecord.status,
                instructions: [
                    '1. Add the bot to your Telegram group or channel',
                    '2. Make sure the bot has permission to read messages',
                    `3. Send this message in the chat: ${codeRecord.code}`,
                    '4. Wait for the confirmation message from the bot',
                    '5. Click "Refresh Connections" below to see your chat',
                ],
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Check the status of a verification code
 * GET /api/v1/integrations/telegram/verification/status
 */
export const getVerificationStatus = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
        }

        const codeRecord = await TelegramVerificationCodeModel.getLatestCodeStatus(userId);

        if (!codeRecord) {
            res.json({
                success: true,
                data: {
                    hasCode: false,
                    message: 'No verification code found. Generate a new code to add a chat.',
                },
            });
            return;
        }

        // Check if expired
        const now = new Date();
        const isExpired = codeRecord.status === 'pending' && new Date(codeRecord.expires_at) < now;

        res.json({
            success: true,
            data: {
                hasCode: true,
                code: codeRecord.code,
                status: isExpired ? 'expired' : codeRecord.status,
                expiresAt: codeRecord.expires_at,
                verifiedAt: codeRecord.verified_at,
                // If verified, include chat info
                chat: codeRecord.status === 'verified' ? {
                    id: codeRecord.chat_id,
                    title: codeRecord.chat_title,
                    type: codeRecord.chat_type,
                } : null,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Cancel a pending verification code and allow generating a new one
 * POST /api/v1/integrations/telegram/verification/cancel
 */
export const cancelVerificationCode = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.userId;
        if (!userId) {
            throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
        }

        // Get the pending code
        const pendingCode = await TelegramVerificationCodeModel.findPendingByUserId(userId);

        if (!pendingCode) {
            res.json({
                success: true,
                message: 'No pending verification code to cancel',
            });
            return;
        }

        // Cancel it
        await TelegramVerificationCodeModel.cancelCode(pendingCode.id, userId);

        res.json({
            success: true,
            message: 'Verification code cancelled. You can now generate a new code.',
        });
    } catch (error) {
        next(error);
    }
};
