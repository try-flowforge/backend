import { Router, Request, Response, NextFunction } from 'express';
import { verifyPrivyToken, AuthenticatedRequest } from '../../middleware/privy-auth';
import { validateBody } from '../../middleware/validation';
import * as emailController from '../../controllers/email.controller';
import { testEmailSchema, sendEmailSchema } from '../../models/email';

const router = Router();

/**
 * All email routes require Privy authentication
 */
router.use(verifyPrivyToken);

/**
 * POST /api/v1/integrations/email/test
 * Test email sending (for verification before workflow execution)
 */
router.post(
  '/test',
  validateBody(testEmailSchema),
  (req: Request, res: Response, next: NextFunction) => {
    emailController.testEmail(req as AuthenticatedRequest, res).catch(next);
  }
);

/**
 * POST /api/v1/integrations/email/send
 * Send an email
 */
router.post(
  '/send',
  validateBody(sendEmailSchema),
  (req: Request, res: Response, next: NextFunction) => {
    emailController.sendEmail(req as AuthenticatedRequest, res).catch(next);
  }
);

export default router;

