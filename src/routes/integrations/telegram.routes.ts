import { Router, Request, Response, NextFunction } from 'express';
import { verifyPrivyToken, AuthenticatedRequest } from '../../middleware/privy-auth';
import { verifyServiceKeyOnly } from '../../middleware/service-auth';
import { validateBody } from '../../middleware/validation';
import {
    createTelegramConnectionSchema,
    sendTelegramMessageSchema,
    verifyFromAgentSchema,
} from '../../models/telegram';
import * as telegramController from '../../controllers/telegram.controller';
import * as telegramWebhookController from '../../controllers/telegram-webhook.controller';

const router = Router();

// ============================================
// Telegram architecture: the AGENT service is the single receiver for Telegram
// updates (webhook). Frontend and backend use these routes; the agent calls
// /ingest (forward updates) and /verification/verify-from-agent (verify codes).
// ============================================

// ============================================
// AGENT-ONLY ROUTES (service key - agent forwards Telegram updates here)
// ============================================

/**
 * Ingest: agent forwards each Telegram update here for message storage and chat discovery.
 * Verification (verify-*) is handled by the agent calling verify-from-agent.
 * POST /ingest
 */
router.post('/ingest', verifyServiceKeyOnly, (req: Request, res: Response) => {
    telegramWebhookController.ingestFromAgent(req, res);
});

/**
 * Agent forwards verify-* messages here (service-key only)
 * POST /verification/verify-from-agent
 */
router.post(
    '/verification/verify-from-agent',
    verifyServiceKeyOnly,
    validateBody(verifyFromAgentSchema),
    (req: Request, res: Response) => {
        telegramWebhookController.verifyFromAgent(req, res);
    }
);

/**
 * Agent looks up connection by chat ID (service-key only). No user Bearer token required.
 * GET /connection-by-chat/:chatId
 */
router.get(
    '/connection-by-chat/:chatId',
    verifyServiceKeyOnly,
    (req: Request, res: Response) => {
        telegramWebhookController.getConnectionByChatId(req, res);
    }
);

// ============================================
// AUTHENTICATED ROUTES
// ============================================

// Apply auth middleware to all routes below
router.use(verifyPrivyToken);

/**
 * Get central bot info
 * GET /bot
 */
router.get('/bot', (req: Request, res: Response, next: NextFunction) => {
    telegramController.getBotInfo(req as AuthenticatedRequest, res, next);
});

/**
 * Get available chats (from getUpdates)
 * GET /chats
 */
router.get('/chats', (req: Request, res: Response, next: NextFunction) => {
    telegramController.getAvailableChats(req as AuthenticatedRequest, res, next);
});

/**
 * Get webhook setup info
 * GET /webhook-info
 */
router.get('/webhook-info', (req: Request, res: Response) => {
    telegramWebhookController.getWebhookInfo(req, res);
});

/**
 * User's saved connections
 * GET /connections
 */
router.get('/connections', (req: Request, res: Response, next: NextFunction) => {
    telegramController.getConnections(req as AuthenticatedRequest, res, next);
});

/**
 * Create a connection
 * POST /connections
 */
router.post(
    '/connections',
    validateBody(createTelegramConnectionSchema),
    (req: Request, res: Response, next: NextFunction) => {
        telegramController.createConnection(req as AuthenticatedRequest, res, next);
    }
);

/**
 * Delete a connection
 * DELETE /connections/:connectionId
 */
router.delete('/connections/:connectionId', (req: Request, res: Response, next: NextFunction) => {
    telegramController.deleteConnection(req as AuthenticatedRequest, res, next);
});

/**
 * Get recent messages for a connection (via webhook)
 * GET /connections/:connectionId/messages
 */
router.get('/connections/:connectionId/messages', (req: Request, res: Response, next: NextFunction) => {
    telegramWebhookController.getRecentMessages(req as AuthenticatedRequest, res, next);
});

/**
 * Send a message
 * POST /send
 */
router.post(
    '/send',
    validateBody(sendTelegramMessageSchema),
    (req: Request, res: Response, next: NextFunction) => {
        telegramController.sendMessage(req as AuthenticatedRequest, res, next);
    }
);

// ============================================
// VERIFICATION CODE ROUTES
// ============================================

/**
 * Generate a verification code for adding a new chat
 * POST /verification/generate
 */
router.post('/verification/generate', (req: Request, res: Response, next: NextFunction) => {
    telegramController.generateVerificationCode(req as AuthenticatedRequest, res, next);
});

/**
 * Check verification code status
 * GET /verification/status
 */
router.get('/verification/status', (req: Request, res: Response, next: NextFunction) => {
    telegramController.getVerificationStatus(req as AuthenticatedRequest, res, next);
});

/**
 * Cancel a pending verification code
 * POST /verification/cancel
 */
router.post('/verification/cancel', (req: Request, res: Response, next: NextFunction) => {
    telegramController.cancelVerificationCode(req as AuthenticatedRequest, res, next);
});

export default router;

