import { Router } from 'express';
import { requireAgentServiceAuth } from '../middleware/agent-service-auth';
import { getPlannerContext } from '../controllers/agent-context.controller';

const router = Router();

router.use(requireAgentServiceAuth);

/**
 * POST /api/v1/agent/context
 * Body: { userId?, telegramUserId?, chatId, requestedFields?, prompt? }
 * Returns: { success: true, data: { context: { telegramChatId, ... } } }
 */
router.post('/context', getPlannerContext);

export default router;
