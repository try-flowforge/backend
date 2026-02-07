import { Router } from 'express';
import {
  getSwapQuote,
  getSupportedProviders,
  getSwapExecution,
  getTokenInfo,
  buildSwapTransaction,
  buildSafeSwapTransaction,
  executeSwapWithSignature,
} from '../controllers/swap.controller';
import { validateParams, validateBody } from '../middleware/validation';
import { verifyPrivyToken } from '../middleware/privy-auth';
import {
  swapProviderChainParamsSchema,
  swapChainParamsSchema,
  swapChainTokenParamsSchema,
  swapInputConfigSchema,
  swapExecuteWithSignatureBodySchema,
} from '../middleware/schemas';

const router = Router();

// Get quote
router.post('/quote/:provider/:chain', validateParams(swapProviderChainParamsSchema), validateBody(swapInputConfigSchema), getSwapQuote);

// Build unsigned transaction (for frontend wallet signing)
router.post('/build-transaction/:provider/:chain', validateParams(swapProviderChainParamsSchema), validateBody(swapInputConfigSchema), buildSwapTransaction);

// Build Safe transaction hash for signing (authenticated)
router.post(
  '/build-safe-transaction/:provider/:chain',
  verifyPrivyToken,
  validateParams(swapProviderChainParamsSchema),
  validateBody(swapInputConfigSchema),
  buildSafeSwapTransaction
);

// Execute swap with signature (authenticated)
router.post(
  '/execute-with-signature/:provider/:chain',
  verifyPrivyToken,
  validateParams(swapProviderChainParamsSchema),
  validateBody(swapExecuteWithSignatureBodySchema),
  executeSwapWithSignature
);

// Get supported providers for chain
router.get('/providers/:chain', validateParams(swapChainParamsSchema), getSupportedProviders);

// Get token info by address
router.get('/providers/:chain/token/:address', validateParams(swapChainTokenParamsSchema), getTokenInfo);

// Get swap execution details
router.get('/executions/:id', getSwapExecution);

export default router;
