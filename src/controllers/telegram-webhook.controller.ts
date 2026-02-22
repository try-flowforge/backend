import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import { TelegramConnectionModel, TelegramVerificationCodeModel } from '../models/telegram';
import { logger } from '../utils/logger';

// In-memory store for incoming messages (per chat); populated via ingest from agent
// In production, use Redis or database
const incomingMessagesStore = new Map<string, Array<{
    updateId: number;
    messageId?: number;
    text?: string;
    from?: { id: number; firstName: string; username?: string };
    date: number;
}>>();

// In-memory store for discovered chats; populated via ingest from agent
interface DiscoveredChat {
    id: string;
    title: string;
    username?: string;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    discoveredAt: number;
    lastActivityAt: number;
}

const discoveredChatsStore = new Map<string, DiscoveredChat>();

/**
 * Get discovered chats from the in-memory store
 * Called by telegram.controller.ts as a fallback when getUpdates fails
 */
export function getDiscoveredChats(): DiscoveredChat[] {
    return Array.from(discoveredChatsStore.values())
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/**
 * Ingest: agent forwards each Telegram update here (service-key only).
 * Stores messages and discovers chats. Verification (verify-*) is handled by the agent.
 * POST /api/v1/integrations/telegram/ingest
 */
export const ingestFromAgent = async (req: Request, res: Response): Promise<void> => {
    try {
        const update = req.body as Record<string, unknown>;
        if (!update || typeof update !== 'object') {
            res.status(400).json({ ok: false, error: 'Missing update body' });
            return;
        }

        // Extract chat info from various update types
        let chat: { id: number | string; title?: string; username?: string; first_name?: string; type: 'private' | 'group' | 'supergroup' | 'channel' } | undefined;

        if (update.message && typeof update.message === 'object' && (update.message as { chat?: unknown }).chat) {
            chat = (update.message as { chat: typeof chat }).chat;
        } else if (update.channel_post && typeof update.channel_post === 'object' && (update.channel_post as { chat?: unknown }).chat) {
            chat = (update.channel_post as { chat: typeof chat }).chat;
        } else if (update.my_chat_member && typeof update.my_chat_member === 'object' && (update.my_chat_member as { chat?: unknown }).chat) {
            chat = (update.my_chat_member as { chat: typeof chat }).chat;
        }

        if (chat) {
            const chatId = String(chat.id);
            const now = Date.now();
            const existing = discoveredChatsStore.get(chatId);

            discoveredChatsStore.set(chatId, {
                id: chatId,
                title: chat.title || chat.first_name || chat.username || 'Unknown',
                username: chat.username,
                type: chat.type,
                discoveredAt: existing?.discoveredAt || now,
                lastActivityAt: now,
            });

            logger.debug({ chatId, title: chat.title || chat.first_name }, 'Chat discovered/updated via ingest');
        }

        const message = (update.message || update.channel_post) as { chat?: { id: number }; message_id?: number; text?: string; from?: { id: number; first_name?: string; username?: string }; date?: number } | undefined;
        if (!message) {
            res.json({ ok: true });
            return;
        }

        const chatId = String(message.chat?.id);
        if (!chatId) {
            res.json({ ok: true });
            return;
        }

        const messages = incomingMessagesStore.get(chatId) || [];
        messages.push({
            updateId: (update.update_id as number) ?? 0,
            messageId: message.message_id,
            text: message.text,
            from: message.from ? {
                id: message.from.id,
                firstName: message.from.first_name ?? '',
                username: message.from.username,
            } : undefined,
            date: message.date ?? 0,
        });

        if (messages.length > 100) {
            messages.shift();
        }
        incomingMessagesStore.set(chatId, messages);

        // If user sent a verification code (e.g. pasted from dashboard), handle it
        const text = message.text?.trim();
        if (text && text.startsWith('verify-')) {
            const discovered = discoveredChatsStore.get(chatId);
            void handleVerificationMessage(
                text,
                chatId,
                discovered?.title ?? 'Unknown',
                discovered?.type ?? 'private'
            );
        }

        logger.debug({ chatId, updateId: update.update_id, text: message.text?.substring(0, 50) }, 'Telegram update ingested');

        res.json({ ok: true });
    } catch (error) {
        logger.error({ error }, 'Error ingesting Telegram update');
        res.status(500).json({ ok: false });
    }
};

/**
 * Handle verification code messages
 * Validates the code and creates a connection if valid
 */
async function handleVerificationMessage(
    code: string,
    chatId: string,
    chatTitle: string,
    chatType: string
): Promise<void> {
    try {
        const { TelegramVerificationCodeModel, TelegramConnectionModel } = await import('../models/telegram');

        // Try to verify the code (atomic operation - only one caller can succeed)
        const verifiedCode = await TelegramVerificationCodeModel.verifyCode(
            code,
            chatId,
            chatTitle,
            chatType
        );

        if (!verifiedCode) {
            logger.info({ code, chatId }, 'Invalid or already used verification code');
            // Send failure message to chat
            await sendTelegramMessage(
                chatId,
                'Invalid or expired verification code. Please generate a new code from the dashboard.'
            );
            return;
        }

        // Verification successful! Create the connection for the user
        const connection = await TelegramConnectionModel.upsert({
            userId: verifiedCode.user_id,
            chatId: chatId,
            chatTitle: chatTitle,
            chatType: chatType as 'private' | 'group' | 'supergroup' | 'channel',
            name: `Verified: ${chatTitle}`,
        });

        logger.info(
            { userId: verifiedCode.user_id, chatId, chatTitle, connectionId: connection.id },
            'Chat verified and connection created'
        );

        // Send success message to chat
        await sendTelegramMessage(
            chatId,
            `**Verified!** This chat is now connected to your account.\n\nYou can now use this chat in your workflows. Return to the dashboard and click "Refresh" to see your connected chat.`
        );
    } catch (error) {
        logger.error({ error, code, chatId }, 'Error handling verification message');
    }
}

/**
 * Send a message to a Telegram chat using the centralized bot
 */
async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        logger.warn('Cannot send verification response - bot token not configured');
        return;
    }

    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown',
            }),
        });

        if (!response.ok) {
            logger.warn({ chatId, status: response.status }, 'Failed to send verification response message');
        }
    } catch (error) {
        logger.error({ error, chatId }, 'Error sending verification response message');
    }
}

/**
 * Verify a code from the agent (agent received verify-* in Telegram and forwards here).
 * POST /api/v1/integrations/telegram/verification/verify-from-agent
 * Body: { code, chatId, chatTitle, chatType }
 * Returns: { success: true, message: "..." } or { success: false, message: "..." } for the agent to send to the user.
 */
export const verifyFromAgent = async (req: Request, res: Response): Promise<void> => {
    try {
        const { code, chatId, chatTitle, chatType } = req.body;

        const verifiedCode = await TelegramVerificationCodeModel.verifyCode(
            code,
            chatId,
            chatTitle,
            chatType
        );

        if (!verifiedCode) {
            res.status(200).json({
                success: false,
                message: 'Invalid or expired verification code. Please generate a new code from the dashboard.',
            });
            return;
        }

        await TelegramConnectionModel.upsert({
            userId: verifiedCode.user_id,
            chatId,
            chatTitle,
            chatType: chatType as 'private' | 'group' | 'supergroup' | 'channel',
            name: `Verified: ${chatTitle}`,
        });

        logger.info(
            { userId: verifiedCode.user_id, chatId, chatTitle },
            'Chat verified and connection created via agent'
        );

        res.status(200).json({
            success: true,
            message:
                '**Verified!** This chat is now connected to your account.\n\nYou can now use this chat in your workflows. Return to the dashboard and click "Refresh" to see your connected chat.',
        });
    } catch (error) {
        logger.error({ error }, 'Error in verifyFromAgent');
        res.status(500).json({
            success: false,
            message: 'Verification failed. Please try again.',
        });
    }
};

/**
 * Get recent messages for a connection
 * GET /api/v1/integrations/telegram/connections/:connectionId/messages
 */
export const getRecentMessages = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = req.userId;
        const connectionId = Array.isArray(req.params.connectionId)
            ? req.params.connectionId[0]
            : req.params.connectionId;

        if (!userId) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        if (!connectionId) {
            res.status(400).json({ success: false, error: 'Invalid connectionId' });
            return;
        }

        // Get connection to find chatId
        const connection = await TelegramConnectionModel.findByIdAndUser(connectionId, userId);
        if (!connection) {
            res.status(404).json({ success: false, error: 'Connection not found' });
            return;
        }

        const chatId = connection.chat_id;
        const messages = incomingMessagesStore.get(chatId) || [];

        res.json({
            success: true,
            data: {
                messages: messages.slice(-50), // Last 50
                count: messages.length,
                chatId,
                chatTitle: connection.chat_title,
            },
        });
    } catch (error) {
        logger.error({ error }, 'Error getting recent messages');
        next(error);
    }
};

/**
 * Get connection by Telegram chat ID (agent-only, service key).
 * Used by the agent to resolve chatId → connectionId and userId for /execute (no user Bearer token).
 * GET /api/v1/integrations/telegram/connection-by-chat/:chatId
 */
export const getConnectionByChatId = async (req: Request, res: Response): Promise<void> => {
    try {
        const chatId = Array.isArray(req.params.chatId) ? req.params.chatId[0] : req.params.chatId;
        if (!chatId) {
            res.status(400).json({ success: false, error: 'Missing chatId' });
            return;
        }

        const connection = await TelegramConnectionModel.findByChatId(chatId);
        if (!connection) {
            logger.info({ chatId }, 'Agent connection-by-chat: no linked connection');
            res.status(404).json({
                success: false,
                error: 'No linked connection for this chat',
                data: { linked: false },
            });
            return;
        }

        logger.info(
            { chatId, connectionId: connection.id, userId: connection.user_id },
            'Agent connection-by-chat: found linked connection'
        );
        res.json({
            success: true,
            data: {
                linked: true,
                connectionId: connection.id,
                userId: connection.user_id,
            },
        });
    } catch (error) {
        logger.error({ error }, 'Error in getConnectionByChatId');
        res.status(500).json({ success: false, error: 'Lookup failed' });
    }
};

/**
 * Generate webhook URL info
 * GET /api/v1/integrations/telegram/webhook-info
 * Note: Telegram updates are received by the agent service. Configure APP_BASE_URL and
 * TELEGRAM_WEBHOOK_PATH on the agent; the agent registers the webhook with Telegram.
 */
export const getWebhookInfo = async (
    _req: Request,
    res: Response
): Promise<void> => {
    res.json({
        success: true,
        data: {
            configured: true,
            webhookUrl: null,
            note: 'Telegram webhook is handled by the agent service. Set APP_BASE_URL and TELEGRAM_WEBHOOK_PATH (and optionally TELEGRAM_MODE=webhook) on the agent so it registers the webhook.',
        },
    });
};
