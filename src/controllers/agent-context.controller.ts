import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import { TelegramConnectionModel } from '../models/telegram/telegram_connection.model';
import { AgentUserContextModel } from '../models/agent/agent_user_context.model';
import { logger } from '../utils/logger';

/** Safe planner context keys (must match agent's sanitizePlannerContext allowlist). */
export const SAFE_CONTEXT_KEYS = new Set([
  'userAddress',
  'privyUserId',
  'telegramChatId',
  'preferredChains',
  'preferredTokens',
  'riskProfile',
  'slippageBps',
]);

export type AgentContextValue = string | number | boolean | string[];

function filterToSafeContext(
  raw: Record<string, unknown>
): Record<string, AgentContextValue> {
  const out: Record<string, AgentContextValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      SAFE_CONTEXT_KEYS.has(key) &&
      value !== undefined &&
      value !== null &&
      (typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        (Array.isArray(value) && value.every((v) => typeof v === 'string')))
    ) {
      out[key] = value as AgentContextValue;
    }
  }
  return out;
}

interface AgentContextBody {
  userId?: string;
  telegramUserId?: string;
  chatId: string;
  requestedFields?: string[];
  prompt?: string;
}

/**
 * POST /api/v1/agent/context
 * Returns planner-safe user context: merged from agent_user_context (stored) + Telegram link.
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

    const context: Record<string, AgentContextValue> = {};
    context.telegramChatId = chatId;

    let linkedUserId: string | null = null;
    try {
      const connection = await TelegramConnectionModel.findByChatId(chatId);
      if (connection) {
        linkedUserId = connection.user_id;
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

    const userIdsToLoad = new Set<string>();
    if (linkedUserId) userIdsToLoad.add(linkedUserId);
    // A2A callers send X-On-Behalf-Of (backend user id); load stored context for them too.
    if (
      authReq.userId &&
      typeof authReq.userId === 'string' &&
      !authReq.userId.startsWith('telegram-')
    ) {
      userIdsToLoad.add(authReq.userId);
    }

    for (const uid of userIdsToLoad) {
      try {
        const stored = await AgentUserContextModel.findByUserId(uid);
        if (stored && stored.context && typeof stored.context === 'object') {
          const storedObj = stored.context as Record<string, unknown>;
          for (const [key, value] of Object.entries(storedObj)) {
            if (SAFE_CONTEXT_KEYS.has(key) && value !== undefined && value !== null) {
              context[key] = value as AgentContextValue;
            }
          }
        }
      } catch (err) {
        logger.warn(
          { err, userId: uid },
          'Agent context: failed to load agent_user_context'
        );
      }
    }

    const safeContext = filterToSafeContext(
      context as Record<string, unknown>
    );

    res.status(200).json({
      success: true,
      data: { context: safeContext },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/users/me/agent-context
 * Returns the current user's stored agent context (Privy auth).
 */
export const getMeAgentContext = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    const row = await AgentUserContextModel.findByUserId(userId);
    const context =
      row && row.context && typeof row.context === 'object'
        ? filterToSafeContext(row.context as Record<string, unknown>)
        : {};

    res.status(200).json({
      success: true,
      data: { context },
    });
  } catch (error) {
    next(error);
  }
};

interface PatchMeAgentContextBody {
  context?: Record<string, unknown>;
}

/**
 * PATCH /api/v1/users/me/agent-context
 * Upsert the current user's agent context; only allowlisted keys are stored (Privy auth).
 */
export const patchMeAgentContext = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    const body = (req.body || {}) as PatchMeAgentContextBody;
    const incoming =
      body.context && typeof body.context === 'object' ? body.context : {};
    const contextToStore = filterToSafeContext(incoming);

    const row = await AgentUserContextModel.upsert(userId, contextToStore);
    const context =
      row.context && typeof row.context === 'object'
        ? filterToSafeContext(row.context as Record<string, unknown>)
        : {};

    res.status(200).json({
      success: true,
      data: { context },
    });
  } catch (error) {
    next(error);
  }
};
