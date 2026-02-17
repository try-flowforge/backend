import { Router, Request, Response, NextFunction } from 'express';
import { verifyPrivyToken, AuthenticatedRequest } from '../middleware/privy-auth';
import * as ensController from '../controllers/ens.controller';
import { validateBody } from '../middleware/validation';
import { registerSubdomainSchema } from '../middleware/schemas';

const router = Router();

router.use(verifyPrivyToken);

/**
 * POST /api/v1/ens/subdomain-registered
 * Record ENS subdomain registration and grant sponsored tx allowance (3 per 0.5 USDC per week).
 */
router.post(
  '/subdomain-registered',
  validateBody(registerSubdomainSchema),
  (req: Request, res: Response, next: NextFunction) => {
    ensController.subdomainRegistered(req as AuthenticatedRequest, res).catch(next);
  }
);

/**
 * GET /api/v1/ens/subdomains
 * List ENS subdomains for the authenticated user.
 */
router.get(
  '/subdomains',
  (req: Request, res: Response, next: NextFunction) => {
    ensController.listSubdomains(req as AuthenticatedRequest, res).catch(next);
  }
);

export default router;
