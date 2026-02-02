import { Router, Request, Response } from 'express';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
  deleteWorkflow,
  executeWorkflow,
  getExecutionStatus,
  getExecutionHistory,
} from '../controllers/workflow.controller';
import { subscribeToExecution } from '../services/ExecutionSSEService';
import { verifyPrivyToken } from '../middleware/privy-auth';

const router = Router();

// Real-time execution updates via Server-Sent Events
// Note: This endpoint is placed before auth middleware because SSE connections
// cannot easily pass Authorization headers. Security is maintained because:
// 1. The executionId is a UUID that was generated during authenticated execution
// 2. This endpoint only provides read-only status updates
router.get('/executions/:executionId/subscribe', (req: Request, res: Response) => {
  const executionId = Array.isArray(req.params.executionId)
    ? req.params.executionId[0]
    : req.params.executionId;
  if (!executionId) {
    res.status(400).json({ success: false, error: 'Invalid executionId' });
    return;
  }
  subscribeToExecution(executionId, res);
});

// Apply Privy authentication to all other workflow routes
router.use(verifyPrivyToken);

// Workflow CRUD
router.post('/', createWorkflow);
router.get('/', listWorkflows);
router.get('/:id', getWorkflow);
router.put('/:id', updateWorkflow);
router.delete('/:id', deleteWorkflow);

// Workflow Execution
router.post('/:id/execute', executeWorkflow);
router.get('/:id/executions', getExecutionHistory);
router.get('/executions/:executionId', getExecutionStatus);

export default router;


