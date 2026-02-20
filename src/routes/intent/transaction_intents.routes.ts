import { Router } from 'express';
import { transactionIntentController } from '../../controllers/intent/transaction_intent.controller';
import { verifyPrivyToken } from '../../middleware/privy-auth';
import { verifyServiceKeyOrPrivyToken } from '../../middleware/service-auth';

const router = Router();

// POST /build — Agent provides workflow steps; backend builds and stores the full multicall intent
router.post('/build', verifyServiceKeyOrPrivyToken, transactionIntentController.buildIntent);

// POST / — Legacy: agent sends raw calldata (placeholder values allowed)
router.post('/', verifyServiceKeyOrPrivyToken, transactionIntentController.createIntent);

// Used by the frontend client
router.get('/:id', verifyPrivyToken, transactionIntentController.getIntent);
router.post('/:id/complete', verifyPrivyToken, transactionIntentController.completeIntent);

export default router;
