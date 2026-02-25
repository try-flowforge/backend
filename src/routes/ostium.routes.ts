import { Router, Request, Response, NextFunction } from 'express';
import {
  cancelOstiumOrder,
  closeOstiumPosition,
  executeOstiumAllowanceApproval,
  executeOstiumDelegationApproval,
  executeOstiumDelegationRevoke,
  getOstiumAccountHistory,
  getOstiumBalance,
  getOstiumDelegationStatus,
  getOstiumMarketDetails,
  getOstiumMarketFunding,
  getOstiumMarketRollover,
  getOstiumPositionMetrics,
  getOstiumPrice,
  getOstiumReadiness,
  getOstiumSetupOverview,
  listOstiumMarkets,
  listOstiumOrders,
  listOstiumPositions,
  openOstiumPosition,
  prepareOstiumAllowanceApproval,
  prepareOstiumDelegationApproval,
  prepareOstiumDelegationRevoke,
  requestOstiumFaucet,
  trackOstiumOrder,
  updateOstiumOrder,
  updateOstiumStopLoss,
  updateOstiumTakeProfit,
} from '../controllers/ostium.controller';
import { verifyServiceKeyOrPrivyToken } from '../middleware/service-auth';
import { validateBody } from '../middleware/validation';
import {
  ostiumBalanceSchema,
  ostiumAllowanceExecuteSchema,
  ostiumAllowancePrepareSchema,
  ostiumMarketsListSchema,
  ostiumPositionCloseSchema,
  ostiumPositionOpenSchema,
  ostiumDelegationPrepareSchema,
  ostiumDelegationStatusSchema,
  ostiumDelegationExecuteSchema,
  ostiumSetupOverviewSchema,
  ostiumReadinessSchema,
  ostiumPositionsListSchema,
  ostiumPositionUpdateSlSchema,
  ostiumPositionUpdateTpSchema,
  ostiumPriceSchema,
  ostiumPositionMetricsSchema,
  ostiumOrderCancelSchema,
  ostiumOrderUpdateSchema,
  ostiumOrderTrackSchema,
  ostiumHistorySchema,
  ostiumFaucetSchema,
  ostiumMarketFundingSchema,
  ostiumMarketDetailsSchema,
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

const isOstiumSetupOverviewEnabled = (): boolean =>
  (process.env.OSTIUM_SETUP_OVERVIEW_ENABLED || 'true').toLowerCase() !== 'false';

const ensureSetupOverviewEnabled = (_req: Request, res: Response, next: NextFunction): void => {
  if (!isOstiumSetupOverviewEnabled()) {
    res.status(503).json({
      success: false,
      error: {
        code: 'OSTIUM_SETUP_OVERVIEW_DISABLED',
        message: 'Ostium setup overview is disabled',
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

// Market Routes
router.post('/markets/list', validateBody(ostiumMarketsListSchema), listOstiumMarkets);
router.post('/markets/funding-rate', validateBody(ostiumMarketFundingSchema), getOstiumMarketFunding);
router.post('/markets/rollover-rate', validateBody(ostiumMarketFundingSchema), getOstiumMarketRollover);
router.post('/markets/details', validateBody(ostiumMarketDetailsSchema), getOstiumMarketDetails);
router.post('/prices/get', validateBody(ostiumPriceSchema), getOstiumPrice);

// Account & Utilities
router.post('/accounts/balance', validateBody(ostiumBalanceSchema), getOstiumBalance);
router.post('/accounts/history', validateBody(ostiumHistorySchema), getOstiumAccountHistory);
router.post('/faucet/request', validateBody(ostiumFaucetSchema), requestOstiumFaucet);

// Positions
router.post('/positions/list', validateBody(ostiumPositionsListSchema), listOstiumPositions);
router.post('/positions/open', validateBody(ostiumPositionOpenSchema), openOstiumPosition);
router.post('/positions/close', validateBody(ostiumPositionCloseSchema), closeOstiumPosition);
router.post('/positions/update-sl', validateBody(ostiumPositionUpdateSlSchema), updateOstiumStopLoss);
router.post('/positions/update-tp', validateBody(ostiumPositionUpdateTpSchema), updateOstiumTakeProfit);
router.post('/positions/metrics', validateBody(ostiumPositionMetricsSchema), getOstiumPositionMetrics);

// Orders
router.post('/orders/list', validateBody(ostiumPositionsListSchema), listOstiumOrders);
router.post('/orders/cancel', validateBody(ostiumOrderCancelSchema), cancelOstiumOrder);
router.post('/orders/update', validateBody(ostiumOrderUpdateSchema), updateOstiumOrder);
router.post('/orders/track', validateBody(ostiumOrderTrackSchema), trackOstiumOrder);

// Setup & Delegation
router.post('/delegations/prepare', validateBody(ostiumDelegationPrepareSchema), prepareOstiumDelegationApproval);
router.post('/delegations/execute', validateBody(ostiumDelegationExecuteSchema), executeOstiumDelegationApproval);
router.post('/delegations/status', validateBody(ostiumDelegationStatusSchema), getOstiumDelegationStatus);
router.post('/delegations/revoke/prepare', validateBody(ostiumDelegationPrepareSchema), prepareOstiumDelegationRevoke);
router.post('/delegations/revoke/execute', validateBody(ostiumDelegationExecuteSchema), executeOstiumDelegationRevoke);
router.post('/setup/overview', ensureSetupOverviewEnabled, validateBody(ostiumSetupOverviewSchema), getOstiumSetupOverview);
router.post('/readiness', validateBody(ostiumReadinessSchema), getOstiumReadiness);
router.post('/allowance/prepare', validateBody(ostiumAllowancePrepareSchema), prepareOstiumAllowanceApproval);
router.post('/allowance/execute', validateBody(ostiumAllowanceExecuteSchema), executeOstiumAllowanceApproval);

export default router;
