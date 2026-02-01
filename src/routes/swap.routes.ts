import { Router } from 'express';
import {
  getSwapQuote,
  getSupportedProviders,
  getSwapExecution,
} from '../controllers/swap.controller';

const router = Router();

// Get quote
router.post('/quote/:provider/:chain', getSwapQuote);

// Get supported providers for chain
router.get('/providers/:chain', getSupportedProviders);

// Get swap execution details
router.get('/executions/:id', getSwapExecution);

export default router;
