import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import { TelegramConnectionModel, TelegramVerificationCodeModel } from '../models/telegram';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// In-memory store for incoming messages (per chat)
// In production, use Redis or database
const incomingMessagesStore = new Map<string, Array<{
    updateId: number;
    messageId?: number;
    text?: string;
    from?: { id: number; firstName: string; username?: string };
    date: number;
}>>();

// In-memory store for discovered chats (from webhooks)
// Maps chatId -> chat info
interface DiscoveredChat {
    id: string;
    title: string;
    username?: string;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    discoveredAt: number;
    lastActivityAt: number;
}

const discoveredChatsStore = new Map<string, DiscoveredChat>();

// Webhook secret for verification (optional security layer)
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

/**
 * Get discovered chats from the in-memory store
 * Called by telegram.controller.ts as a fallback when getUpdates fails
 */
export function getDiscoveredChats(): DiscoveredChat[] {
    return Array.from(discoveredChatsStore.values())
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/**
 * Handle incoming webhook updates from Telegram
 * POST /api/v1/integrations/telegram/webhook/:secret
 * 
 * This is a PUBLIC endpoint - Telegram calls it directly
 */
export const handleIncomingWebhook = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { secret } = req.params;

        // Verify webhook secret if configured
        if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
            logger.warn({ providedSecret: secret }, 'Invalid webhook secret');
            res.status(401).json({ ok: false });
            return;
        }

        const update = req.body;

        // Extract chat info from various update types
        let chat: { id: number | string; title?: string; username?: string; first_name?: string; type: 'private' | 'group' | 'supergroup' | 'channel' } | undefined;

        if (update.message?.chat) {
            chat = update.message.chat;
        } else if (update.channel_post?.chat) {
            chat = update.channel_post.chat;
        } else if (update.my_chat_member?.chat) {
            // Bot was added/removed from a chat
            chat = update.my_chat_member.chat;
        }

        // Store discovered chat
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

            logger.debug({ chatId, title: chat.title || chat.first_name }, 'Chat discovered/updated via webhook');
        }

        // Extract message for message store
        const message = update.message || update.channel_post;
        if (!message) {
            // Acknowledge other update types but don't process further
            res.json({ ok: true });
            return;
        }

        const chatId = String(message.chat.id);

        // Store the message
        const messages = incomingMessagesStore.get(chatId) || [];
        messages.push({
            updateId: update.update_id,
            messageId: message.message_id,
            text: message.text,
            from: message.from ? {
                id: message.from.id,
                firstName: message.from.first_name,
                username: message.from.username,
            } : undefined,
            date: message.date,
        });

        // Keep only last 100 messages per chat
        if (messages.length > 100) {
            messages.shift();
        }
        incomingMessagesStore.set(chatId, messages);

        // Check if this is a verification message
        const messageText = message.text?.trim().toLowerCase();
        if (messageText && messageText.startsWith('verify-')) {
            await handleVerificationMessage(
                messageText,
                chatId,
                chat?.title || chat?.first_name || chat?.username || 'Unknown',
                chat?.type || 'private'
            );
        }

        logger.info({ chatId, updateId: update.update_id, text: message.text?.substring(0, 50) }, 'Telegram webhook received');

        res.json({ ok: true });
    } catch (error) {
        logger.error({ error }, 'Error processing Telegram webhook');
        // Always respond 200 to Telegram to prevent retries
        res.json({ ok: true });
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
 * Generate webhook URL info
 * GET /api/v1/integrations/telegram/webhook-info
 */
export const getWebhookInfo = async (
    _req: Request,
    res: Response
): Promise<void> => {
    const baseUrl = process.env.TELEGRAM_WEBHOOK_BASE_URL;
    const secret = WEBHOOK_SECRET || crypto.randomBytes(16).toString('hex');

    res.json({
        success: true,
        data: {
            configured: !!baseUrl,
            webhookUrl: baseUrl ? `${baseUrl}/api/v1/integrations/telegram/webhook/${secret}` : null,
            note: baseUrl ?
                'Use this URL when setting up webhook via setWebhook API' :
                'Set TELEGRAM_WEBHOOK_BASE_URL in .env to enable webhooks',
        },
    });
};
