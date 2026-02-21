import { Router, Request, Response, NextFunction } from 'express';
import {
  closeOstiumPosition,
  executeOstiumDelegationApproval,
  executeOstiumDelegationRevoke,
  getOstiumBalance,
  getOstiumDelegationStatus,
  getOstiumPrice,
  listOstiumMarkets,
  listOstiumPositions,
  openOstiumPosition,
  prepareOstiumDelegationApproval,
  prepareOstiumDelegationRevoke,
  updateOstiumStopLoss,
  updateOstiumTakeProfit,
} from '../controllers/ostium.controller';
import { verifyServiceKeyOrPrivyToken } from '../middleware/service-auth';
import { validateBody } from '../middleware/validation';
import {
  ostiumBalanceSchema,
  ostiumMarketsListSchema,
  ostiumPositionCloseSchema,
  ostiumPositionOpenSchema,
  ostiumDelegationPrepareSchema,
  ostiumDelegationStatusSchema,
  ostiumDelegationExecuteSchema,
  ostiumPositionsListSchema,
  ostiumPositionUpdateSlSchema,
  ostiumPositionUpdateTpSchema,
  ostiumPriceSchema,
} from '../middleware/schemas';

const router = Router();

const isOstiumEnabled = (): boolean => (process.env.OSTIUM_ENABLED || 'false').toLowerCase() === 'true';

const ensureOstiumEnabled = (_req: Request, res: Response, next: NextFunction): void => {
  if (!isOstiumEnabled()) {
    res.status(503).json({
      success: false,
      error: {
        code: 'OSTIUM_DISABLED',
        message: 'Ostium integration is disabled',
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }
  next();
};

router.use(verifyServiceKeyOrPrivyToken);
router.use(ensureOstiumEnabled);

router.post('/markets/list', validateBody(ostiumMarketsListSchema), listOstiumMarkets);
router.post('/prices/get', validateBody(ostiumPriceSchema), getOstiumPrice);
router.post('/accounts/balance', validateBody(ostiumBalanceSchema), getOstiumBalance);
router.post('/positions/list', validateBody(ostiumPositionsListSchema), listOstiumPositions);
router.post('/positions/open', validateBody(ostiumPositionOpenSchema), openOstiumPosition);
router.post('/positions/close', validateBody(ostiumPositionCloseSchema), closeOstiumPosition);
router.post('/positions/update-sl', validateBody(ostiumPositionUpdateSlSchema), updateOstiumStopLoss);
router.post('/positions/update-tp', validateBody(ostiumPositionUpdateTpSchema), updateOstiumTakeProfit);
router.post('/delegations/prepare', validateBody(ostiumDelegationPrepareSchema), prepareOstiumDelegationApproval);
router.post('/delegations/execute', validateBody(ostiumDelegationExecuteSchema), executeOstiumDelegationApproval);
router.post('/delegations/status', validateBody(ostiumDelegationStatusSchema), getOstiumDelegationStatus);
router.post('/delegations/revoke/prepare', validateBody(ostiumDelegationPrepareSchema), prepareOstiumDelegationRevoke);
router.post('/delegations/revoke/execute', validateBody(ostiumDelegationExecuteSchema), executeOstiumDelegationRevoke);

export default router;
