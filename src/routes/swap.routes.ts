import { Router } from 'express';
import {
  getSwapQuote,
  getSupportedProviders,
  getSwapExecution,
  getTokenInfo,
  buildSwapTransaction,
} from '../controllers/swap.controller';

const router = Router();

// Get quote
router.post('/quote/:provider/:chain', getSwapQuote);

// Build unsigned transaction (for frontend wallet signing)
router.post('/build-transaction/:provider/:chain', buildSwapTransaction);

// Get supported providers for chain
router.get('/providers/:chain', getSupportedProviders);

// Get token info by address
router.get('/providers/:chain/token/:address', getTokenInfo);

// Get swap execution details
router.get('/executions/:id', getSwapExecution);

export default router;
