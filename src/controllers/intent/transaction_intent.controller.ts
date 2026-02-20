import { Request, Response } from 'express';
import { transactionIntentService } from '../../services/intent/transaction_intent.service';
import { intentBuilderService } from '../../services/intent/intent-builder.service';
import { getSafeTransactionService } from '../../services/safe-transaction.service';
import { createTransactionIntentSchema, completeTransactionIntentSchema, buildTransactionIntentSchema } from '../../models/intent';
import { logger } from '../../utils/logger';
import { type NumericChainId } from '../../config/chain-registry';

export class TransactionIntentController {

    /**
     * POST /api/v1/intents
     * Legacy: agent sends raw calldata (placeholder values allowed).
     */
    async createIntent(req: Request, res: Response): Promise<void> {
        try {
            const parsedData = createTransactionIntentSchema.parse(req.body);

            const intent = await transactionIntentService.createIntent(parsedData);

            res.status(201).json({
                success: true,
                data: intent
            });
        } catch (error) {
            logger.error({ err: error }, 'Failed to create transaction intent');
            res.status(400).json({ success: false, error: 'Invalid input or server error' });
        }
    }

    /**
     * POST /api/v1/intents/build
     * New: agent provides workflow steps; backend builds real multicall calldata,
     * computes safeTxHash, and stores the intent ready for frontend signing.
     */
    async buildIntent(req: Request, res: Response): Promise<void> {
        try {
            const parsedData = buildTransactionIntentSchema.parse(req.body);

            const intent = await intentBuilderService.buildIntentFromSteps(parsedData);

            res.status(201).json({
                success: true,
                data: intent,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error({ err: error }, 'Failed to build transaction intent');
            res.status(400).json({ success: false, error: message });
        }
    }

    /**
     * GET /api/v1/intents/:id
     * Frontend fetches intent details (safeTxHash, safeTxData, description) for display and signing.
     */
    async getIntent(req: Request, res: Response): Promise<void> {
        try {
            const id = req.params.id as string;
            const intent = await transactionIntentService.getIntent(id);

            if (!intent) {
                res.status(404).json({ success: false, error: 'Intent not found' });
                return;
            }

            res.json({
                success: true,
                data: intent
            });
        } catch (error) {
            logger.error({ err: error, id: req.params.id }, 'Failed to get transaction intent');
            res.status(500).json({ success: false, error: 'Server error' });
        }
    }

    /**
     * POST /api/v1/intents/:id/complete
     * Called by the frontend after the user signs the safeTxHash.
     * Backend broadcasts the transaction via the relayer and marks the intent complete.
     */
    async completeIntent(req: Request, res: Response): Promise<void> {
        try {
            const id = req.params.id as string;
            const { signature } = completeTransactionIntentSchema.parse(req.body);

            // Load the intent to get pre-built safeTxData
            const intent = await transactionIntentService.getIntent(id);
            if (!intent) {
                res.status(404).json({ success: false, error: 'Intent not found' });
                return;
            }
            if (intent.status !== 'PENDING') {
                res.status(400).json({ success: false, error: `Intent is not pending (status: ${intent.status})` });
                return;
            }

            // If we have pre-built safe tx data, broadcast via relayer
            if (intent.safeTxData && intent.safeTxHash) {
                const safeTransactionService = getSafeTransactionService();
                const { to, value, data, operation } = intent.safeTxData;

                const { txHash } = await safeTransactionService.executeWithSignatures(
                    intent.safeAddress,
                    intent.chainId as NumericChainId,
                    to,
                    BigInt(value),
                    data,
                    operation,
                    signature,
                    intent.safeTxHash
                );

                const completed = await transactionIntentService.completeIntent(id, txHash);
                res.json({ success: true, data: completed });
                return;
            }

            // Fallback: no pre-built tx data — caller must supply txHash in signature field
            // (backward-compatible path)
            const completed = await transactionIntentService.completeIntent(id, signature);
            if (!completed) {
                res.status(404).json({ success: false, error: 'Intent not found or not pending' });
                return;
            }
            res.json({ success: true, data: completed });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error({ err: error, id: req.params.id }, 'Failed to complete transaction intent');
            res.status(400).json({ success: false, error: message });
        }
    }
}

export const transactionIntentController = new TransactionIntentController();
