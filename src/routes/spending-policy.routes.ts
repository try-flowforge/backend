import { Router, Request, Response, NextFunction } from 'express';
import { verifyPrivyToken, AuthenticatedRequest } from '../middleware/privy-auth';
import { validateBody, validateParams } from '../middleware/validation';
import {
  executeSpendingPolicySchema,
  spendingPolicyGetParamsSchema,
  spendingPolicyPrepareSchema,
  spendingPolicyRevokeParamsSchema,
  spendingPolicyUpsertSchema,
} from '../middleware/schemas';
import {
  executeSpendingPolicy,
  getSpendingPolicy,
  prepareSpendingPolicy,
  revokeSpendingPolicy,
  upsertSpendingPolicy,
} from '../controllers/spending-policy.controller';

const router = Router();

router.use(verifyPrivyToken);

router.get(
  '/:network/:chainId',
  validateParams(spendingPolicyGetParamsSchema),
  (req: Request, res: Response, next: NextFunction) => {
    getSpendingPolicy(req as AuthenticatedRequest, res, next).catch(next);
  }
);

router.post(
  '/',
  validateBody(spendingPolicyUpsertSchema),
  (req: Request, res: Response, next: NextFunction) => {
    upsertSpendingPolicy(req as AuthenticatedRequest, res, next).catch(next);
  }
);

router.delete(
  '/:network/:chainId',
  validateParams(spendingPolicyRevokeParamsSchema),
  (req: Request, res: Response, next: NextFunction) => {
    revokeSpendingPolicy(req as AuthenticatedRequest, res, next).catch(next);
  }
);

router.post(
  '/prepare',
  validateBody(spendingPolicyPrepareSchema),
  (req: Request, res: Response, next: NextFunction) => {
    prepareSpendingPolicy(req as AuthenticatedRequest, res, next).catch(next);
  }
);

router.post(
  '/execute',
  validateBody(executeSpendingPolicySchema),
  (req: Request, res: Response, next: NextFunction) => {
    executeSpendingPolicy(req as AuthenticatedRequest, res, next).catch(next);
  }
);

export default router;
