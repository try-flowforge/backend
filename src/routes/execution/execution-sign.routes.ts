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

            const data: Record<string, unknown> = {
                executionId: context.executionId,
                status: context.status,
            };
            if ((context as any).submitOnClientPayload) {
                data.submitOnClient = true;
                data.payload = (context as any).submitOnClientPayload.payload;
                data.executionId = (context as any).submitOnClientPayload.executionId;
            }

            res.status(200).json({
                success: true,
                data,
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

/**
 * POST /executions/:executionId/report-client-tx
 * Report a client-submitted tx hash (mainnet user-funded) and continue the workflow.
 * Body: { txHash: string }
 */
router.post(
    '/:executionId/report-client-tx',
    verifyPrivyToken,
    async (req: Request, res: Response): Promise<void> => {
        try {
            const executionId = req.params.executionId as string;
            const { txHash } = req.body;

            if (!txHash || typeof txHash !== 'string') {
                res.status(400).json({
                    success: false,
                    error: 'Missing or invalid txHash',
                });
                return;
            }

            logger.info({ executionId, txHash }, 'Reporting client-submitted tx for execution');

            const context = await workflowExecutionEngine.reportClientTx(executionId, txHash);

            res.status(200).json({
                success: true,
                data: {
                    executionId: context.executionId,
                    status: context.status,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error({ error: message }, 'Failed to report client tx');

            res.status(400).json({
                success: false,
                error: message,
            });
        }
    }
);

export default router;
