import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import { TelegramConnectionModel } from '../models/telegram/telegram_connection.model';
import { logger } from '../utils/logger';

/** Safe planner context keys (must match agent's sanitizePlannerContext allowlist). */
const SAFE_CONTEXT_KEYS = new Set([
  'userAddress',
  'privyUserId',
  'telegramChatId',
  'preferredChains',
  'preferredTokens',
  'riskProfile',
  'slippageBps',
]);

interface AgentContextBody {
  userId?: string;
  telegramUserId?: string;
  chatId: string;
  requestedFields?: string[];
  prompt?: string;
}

/**
 * POST /api/v1/agent/context
 * Returns planner-safe user context for the given chat (e.g. telegramChatId).
 * Called by the agent with X-Service-Key + X-On-Behalf-Of.
 */
export const getPlannerContext = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const body = req.body as AgentContextBody;

    const chatId =
      typeof body.chatId === 'string' && body.chatId.trim().length > 0
        ? body.chatId.trim()
        : null;

    if (!chatId) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid chatId',
      });
      return;
    }

    const requestedFields = Array.isArray(body.requestedFields)
      ? body.requestedFields.filter((f) => typeof f === 'string')
      : [];

    const context: Record<string, string | number | boolean | string[]> = {};

    // Always provide telegramChatId so the LLM can use it for notification steps
    context.telegramChatId = chatId;

    // Optionally enrich from telegram_connections (linked user)
    try {
      const connection = await TelegramConnectionModel.findByChatId(chatId);
      if (connection) {
        if (
          requestedFields.includes('privyUserId') ||
          requestedFields.length === 0
        ) {
          context.privyUserId = connection.user_id;
        }
      }
    } catch (err) {
      logger.warn(
        { err, chatId, userId: authReq.userId },
        'Agent context: failed to lookup telegram connection'
      );
    }

    // Only return keys that are in the safe allowlist
    const safeContext: Record<string, string | number | boolean | string[]> =
      {};
    for (const [key, value] of Object.entries(context)) {
      if (SAFE_CONTEXT_KEYS.has(key) && value !== undefined && value !== null) {
        safeContext[key] = value;
      }
    }

    res.status(200).json({
      success: true,
      data: { context: safeContext },
    });
  } catch (error) {
    next(error);
  }
};
