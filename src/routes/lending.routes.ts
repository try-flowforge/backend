import { Router } from 'express';
import {
  getLendingQuote,
  getSupportedLendingProviders,
  getLendingExecution,
  getLendingExecutionsByWallet,
  getLendingPosition,
  getLendingAccountData,
  getAssetReserveData,
  getAvailableAssets,
} from '../controllers/lending.controller';
import { validateParams, validateBody } from '../middleware/validation';
import {
  lendingProviderChainParamsSchema,
  lendingChainParamsSchema,
  lendingPositionParamsSchema,
  lendingAssetParamsSchema,
  lendingQuoteBodySchema,
} from '../middleware/schemas';

const router = Router();

// Get quote for lending operation
router.post('/quote/:provider/:chain', validateParams(lendingProviderChainParamsSchema), validateBody(lendingQuoteBodySchema), getLendingQuote);

// Get supported providers for chain
router.get('/providers/:chain', validateParams(lendingChainParamsSchema), getSupportedLendingProviders);

// Get lending execution details
router.get('/executions/:id', getLendingExecution);

// Get lending executions for a wallet
router.get('/executions/wallet/:walletAddress', getLendingExecutionsByWallet);

// Get user's lending position
router.get('/position/:provider/:chain/:walletAddress', validateParams(lendingPositionParamsSchema), getLendingPosition);

// Get user's account data (health factor, etc.)
router.get('/account/:provider/:chain/:walletAddress', validateParams(lendingPositionParamsSchema), getLendingAccountData);

// Get asset reserve data (APY, liquidity, etc.)
router.get('/asset/:provider/:chain/:asset', validateParams(lendingAssetParamsSchema), getAssetReserveData);

// Get available assets for lending/borrowing
router.get('/assets/:provider/:chain', validateParams(lendingProviderChainParamsSchema), getAvailableAssets);

export default router;

