import { Router } from 'express';
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

export default router;

