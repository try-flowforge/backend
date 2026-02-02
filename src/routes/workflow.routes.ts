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

const router = Router();

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

// Real-time execution updates via Server-Sent Events
router.get('/executions/:executionId/subscribe', (req: Request, res: Response) => {
  const executionId = Array.isArray(req.params.executionId)
    ? req.params.executionId[0]
    : req.params.executionId;
  if (!executionId) {
    res.status(400).json({ success: false, error: { message: 'Invalid executionId', code: 'BAD_REQUEST' } });
    return;
  }
  subscribeToExecution(executionId, res);
});

export default router;

