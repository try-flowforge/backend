import { Router, Request, Response, NextFunction } from 'express';
import { verifyPrivyToken, AuthenticatedRequest } from '../../middleware/privy-auth';
import { validateBody } from '../../middleware/validation';
import {
    createTelegramConnectionSchema,
    sendTelegramMessageSchema,
} from '../../models/telegram';
import * as telegramController from '../../controllers/telegram.controller';
import * as telegramWebhookController from '../../controllers/telegram-webhook.controller';

const router = Router();

// ============================================
// PUBLIC ROUTES (no auth - called by Telegram)
// ============================================

/**
 * Webhook endpoint for Telegram updates
 * POST /webhook/:secret
 */
router.post('/webhook/:secret', (req: Request, res: Response) => {
    telegramWebhookController.handleIncomingWebhook(req, res);
});

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
router.get('/connections/:connectionId/messages', (req: Request, res: Response) => {
    telegramWebhookController.getRecentMessages(req, res);
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

export default router;
