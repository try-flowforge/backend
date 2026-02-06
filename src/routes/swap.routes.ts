import { Router } from 'express';
import {
  getSwapQuote,
  getSupportedProviders,
  getSwapExecution,
  getTokenInfo,
  buildSwapTransaction,
} from '../controllers/swap.controller';
import { validateParams, validateBody } from '../middleware/validation';
import {
  swapProviderChainParamsSchema,
  swapChainParamsSchema,
  swapChainTokenParamsSchema,
  swapInputConfigSchema,
} from '../middleware/schemas';

const router = Router();

// Get quote
router.post('/quote/:provider/:chain', validateParams(swapProviderChainParamsSchema), validateBody(swapInputConfigSchema), getSwapQuote);

// Build unsigned transaction (for frontend wallet signing)
router.post('/build-transaction/:provider/:chain', validateParams(swapProviderChainParamsSchema), validateBody(swapInputConfigSchema), buildSwapTransaction);

// Get supported providers for chain
router.get('/providers/:chain', validateParams(swapChainParamsSchema), getSupportedProviders);

// Get token info by address
router.get('/providers/:chain/token/:address', validateParams(swapChainTokenParamsSchema), getTokenInfo);

// Get swap execution details
router.get('/executions/:id', getSwapExecution);

export default router;
