import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { swapExecutionService } from '../swap/SwapExecutionService';
import { transactionIntentService } from './transaction_intent.service';
import { getSafeTransactionService } from '../safe-transaction.service';
import { SwapProvider, SupportedChain, SwapType } from '../../types/swap.types';
import { type NumericChainId } from '../../config/chain-registry';
import { TransactionIntent, BuildTransactionIntentInput } from '../../models/intent';

interface SwapStepHints {
    provider: string;
    chain: string;
    tokenIn?: string;
    tokenOut?: string;
    amount?: string;
    slippage?: string;
    amountIn?: string;
    [key: string]: string | number | undefined;
}

/**
 * Orchestrates building a fully-encoded multicall Safe transaction from planner workflow steps.
 * Each step's calldata is built by the relevant service (swap/lending), then bundled 
 * into a single Safe multiSend call for one-signature UX.
 */
export class IntentBuilderService {
    /**
     * Builds a complete, signed-ready TransactionIntent from structured workflow steps.
     * The returned intent contains the real `safeTxHash` and `safeTxData` — the frontend
     * only needs to call `wallet.sign(intent.safeTxHash)` and send the signature back.
     */
    async buildIntentFromSteps(input: BuildTransactionIntentInput): Promise<TransactionIntent> {
        const { userId, agentUserId, safeAddress, chainId, steps, description } = input;

        const safeTransactionService = getSafeTransactionService();

        logger.info({ userId, chainId, stepCount: steps.length }, 'Building multicall intent from steps');

        const allCalls: Array<{ to: string; value: bigint; data: string }> = [];


        for (const step of steps) {
            if (step.blockType === 'swap') {
                const hints = step.configHints as SwapStepHints;

                // Map agent hint fields to SwapInputConfig
                const chain = (hints.chain as SupportedChain) ?? SupportedChain.ARBITRUM;
                const provider = (hints.provider as SwapProvider) ?? SwapProvider.UNISWAP;

                const swapConfig = {
                    sourceToken: {
                        address: (hints.tokenIn ?? hints.sourceToken ?? '') as string,
                        symbol: '',
                        decimals: 18,
                    },
                    destinationToken: {
                        address: (hints.tokenOut ?? hints.destinationToken ?? '') as string,
                        symbol: '',
                        decimals: 18,
                    },
                    amount: (hints.amount ?? hints.amountIn ?? '0') as string,
                    slippageTolerance: parseFloat((hints.slippage ?? '0.5') as string),
                    swapType: SwapType.EXACT_INPUT,
                    walletAddress: safeAddress,
                    recipient: safeAddress,
                };

                // Use a synthetic node execution ID for the builder context
                const nodeExecutionId = uuidv4();

                // `buildSwapTransactionForSigning` already handles approval + swap multicall internally
                const safeTxResult = await swapExecutionService.buildSwapTransactionForSigning(
                    nodeExecutionId,
                    chain,
                    provider,
                    swapConfig,
                    userId
                );

                // Add the multicall (approve+swap) as a single call entry
                allCalls.push({
                    to: safeTxResult.safeTxData.to,
                    value: BigInt(safeTxResult.safeTxData.value),
                    data: safeTxResult.safeTxData.data,
                });

                logger.info({ chain, provider }, 'Built swap calldata for step');
            } else if (step.blockType === 'lending') {
                // TODO: integrate LendingService.buildTransactionForSigning() once implemented
                logger.warn({ step }, 'Lending step building not yet implemented — skipping');
            }
        }

        if (allCalls.length === 0) {
            throw new Error('No callable steps could be encoded — cannot build intent');
        }

        // If there are multiple calls, wrap everything into a Safe multiSend
        let finalCall: { to: string; value: bigint; data: string; operation: number };

        if (allCalls.length === 1) {
            finalCall = { ...allCalls[0], operation: 0 }; // CALL
        } else {
            const multicall = safeTransactionService.buildMulticallFromCalls(allCalls, chainId as NumericChainId);
            finalCall = { ...multicall, operation: 1 }; // DELEGATECALL for multiSend
        }

        // Compute Safe transaction hash that user must sign
        const safeTxHash = await safeTransactionService.buildSafeTransactionHash(
            safeAddress,
            chainId as NumericChainId,
            finalCall.to,
            finalCall.value,
            finalCall.data,
            finalCall.operation
        );

        logger.info({ safeTxHash, safeAddress }, 'Computed safeTxHash for intent');

        // Persist and return the intent
        return transactionIntentService.createIntent({
            userId,
            agentUserId: agentUserId ?? userId,
            safeAddress,
            chainId,
            to: finalCall.to,
            value: finalCall.value.toString(),
            data: finalCall.data,
            description: description ?? undefined,
            safeTxHash,
            safeTxData: {
                to: finalCall.to,
                value: finalCall.value.toString(),
                data: finalCall.data,
                operation: finalCall.operation,
            },
        });
    }
}

export const intentBuilderService = new IntentBuilderService();
