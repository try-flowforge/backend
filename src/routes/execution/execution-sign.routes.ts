import { Router, Request, Response } from 'express';
import { workflowExecutionEngine } from '../../services/workflow/WorkflowExecutionEngine';
import { verifyPrivyToken } from '../../middleware/privy-auth';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * POST /executions/:executionId/sign
 * Resume a paused workflow execution by providing a user signature.
 * 
 * Body: { signature: string }
 */
router.post(
    '/:executionId/sign',
    verifyPrivyToken,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const executionId = req.params.executionId as string;
            const { signature } = req.body;

            if (!signature || typeof signature !== 'string') {
                res.status(400).json({
                    success: false,
                    error: 'Missing or invalid signature',
                });
                return;
            }

            logger.info({ executionId }, 'Received signature for paused execution');

            const context = await workflowExecutionEngine.resumeExecution(
                executionId,
                signature
            );

            res.status(200).json({
                success: true,
                data: {
                    executionId: context.executionId,
                    status: context.status,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error({ error: message }, 'Failed to resume execution with signature');

            res.status(400).json({
                success: false,
                error: message,
            });
        }
    }
);

export default router;
