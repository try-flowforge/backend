import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import { TelegramConnectionModel } from '../models/telegram';
import { AppError } from '../middleware/error-handler';
import { logger } from '../utils/logger';

function paramString(
    params: Record<string, string | string[] | undefined>,
    key: string
): string {
    const v = params[key];
    const s = Array.isArray(v) ? v[0] : v;
    if (s == null || s === '')
        throw new AppError(400, `Missing or invalid parameter: ${key}`, 'INVALID_PARAM');
    return s;
}

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

interface TelegramUpdate {
    update_id: number;
    message?: {
        chat: TelegramChat;
        from?: { id: number; first_name: string };
        text?: string;
    };
    channel_post?: {
        chat: TelegramChat;
    };
    my_chat_member?: {
        chat: TelegramChat;
    };
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
 * Get available chats where the bot has been added
 * GET /api/v1/integrations/telegram/chats
 */
export const getAvailableChats = async (
    _req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Use getUpdates to find chats the bot has interacted with
        const updates = await callTelegramApi<TelegramUpdate[]>('getUpdates', {
            limit: 100,
            allowed_updates: ['message', 'channel_post', 'my_chat_member'],
        });

        // Extract unique chats
        const chatMap = new Map<string, TelegramChat>();

        for (const update of updates) {
            let chat: TelegramChat | undefined;

            if (update.message?.chat) {
                chat = update.message.chat;
            } else if (update.channel_post?.chat) {
                chat = update.channel_post.chat;
            } else if (update.my_chat_member?.chat) {
                chat = update.my_chat_member.chat;
            }

            if (chat) {
                const chatId = String(chat.id);
                if (!chatMap.has(chatId)) {
                    chatMap.set(chatId, chat);
                }
            }
        }

        const chats = Array.from(chatMap.values()).map((chat) => ({
            id: String(chat.id),
            title: chat.title || chat.first_name || chat.username || 'Unknown',
            username: chat.username,
            type: chat.type,
        }));

        res.json({
            success: true,
            data: { chats },
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
        if (!userId) {
            throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
        }

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

        const connectionId = paramString(req.params, 'connectionId');
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
