import axios from 'axios';
import {
    SwapProvider,
    SupportedChain,
    SwapInputConfig,
    SwapQuote,
    SwapTransaction,
} from '../../../types';
import { ISwapProvider } from '../interfaces/ISwapProvider';
import { PROVIDER_CONFIGS, CHAIN_CONFIGS } from '../../../config/chains';
import { getProvider } from '../../../config/providers';
import { logger } from '../../../utils/logger';

/**
 * LI.FI Provider Implementation
 * LI.FI is a DEX aggregator that aggregates liquidity from multiple DEXs, bridges, and solvers
 * to find the best swap routes across chains.
 * 
 * API Documentation: https://apidocs.li.fi
 * Base URL: https://li.quest/v1
 */
export class LiFiProvider implements ISwapProvider {
    private apiUrl: string;
    private apiKey: string | undefined;
    private integratorId: string;

    constructor() {
        this.apiUrl = PROVIDER_CONFIGS.LIFI.apiUrl;
        this.apiKey = PROVIDER_CONFIGS.LIFI.apiKey;
        this.integratorId = PROVIDER_CONFIGS.LIFI.integratorId || 'agentic-workflow';

        if (!this.apiKey) {
            logger.warn('LI.FI API key not configured - rate limits will be restricted');
        }
    }

    getName(): SwapProvider {
        return SwapProvider.LIFI;
    }

    supportsChain(chain: SupportedChain): boolean {
        // LI.FI supports both Arbitrum and Arbitrum Sepolia
        // However, testnet support may have limited liquidity sources
        return chain === SupportedChain.ARBITRUM || chain === SupportedChain.ARBITRUM_SEPOLIA;
    }

    async getQuote(
        chain: SupportedChain,
        config: SwapInputConfig
    ): Promise<SwapQuote> {
        logger.debug({ chain, config }, 'Getting LI.FI quote');

        try {
            const chainConfig = CHAIN_CONFIGS[chain];
            const slippage = (config.slippageTolerance || 0.5) / 100; // LI.FI expects decimal format (0.005 for 0.5%)

            // LI.FI /quote endpoint for single-step routes
            // For same-chain swaps, fromChain === toChain
            // fromAddress should be the Safe address (recipient) if provided, otherwise walletAddress
            // This ensures tokens are taken from and sent to the Safe wallet
            const fromAddress = config.recipient || config.walletAddress;
            
            const response = await axios.get(
                `${this.apiUrl}/quote`,
                {
                    params: {
                        fromChain: chainConfig.chainId,
                        toChain: chainConfig.chainId,
                        fromToken: config.sourceToken.address,
                        toToken: config.destinationToken.address,
                        fromAmount: config.amount,
                        fromAddress: fromAddress, // Use Safe address if available
                        slippage: slippage,
                        integrator: this.integratorId,
                    },
                    headers: this.getHeaders(),
                    timeout: 15000,
                }
            );

            const quoteData = response.data;

            // Extract relevant data from LI.FI response
            const estimate = quoteData.estimate || {};
            const action = quoteData.action || {};

            const quote: SwapQuote = {
                provider: SwapProvider.LIFI,
                chain,
                sourceToken: {
                    address: action.fromToken?.address || config.sourceToken.address,
                    symbol: action.fromToken?.symbol || config.sourceToken.symbol,
                    decimals: action.fromToken?.decimals || config.sourceToken.decimals,
                    name: action.fromToken?.name,
                },
                destinationToken: {
                    address: action.toToken?.address || config.destinationToken.address,
                    symbol: action.toToken?.symbol || config.destinationToken.symbol,
                    decimals: action.toToken?.decimals || config.destinationToken.decimals,
                    name: action.toToken?.name,
                },
                amountIn: estimate.fromAmount || config.amount,
                amountOut: estimate.toAmount || '0',
                estimatedAmountOut: estimate.toAmountMin || estimate.toAmount || '0',
                route: this.extractRoute(quoteData),
                priceImpact: this.calculatePriceImpact(estimate),
                gasEstimate: this.extractGasEstimate(estimate),
                estimatedGasCost: estimate.gasCosts?.[0]?.amountUSD || '0',
                validUntil: Date.now() + 60000, // LI.FI quotes typically valid for 60 seconds
                rawQuote: quoteData,
            };

            logger.debug({ quote }, 'LI.FI quote generated');
            return quote;
        } catch (error) {
            logger.error({ error, chain, config }, 'Failed to get LI.FI quote');

            // Check for specific LI.FI error codes
            if (axios.isAxiosError(error) && error.response) {
                const lifiError = error.response.data;
                throw new Error(`LI.FI quote failed: ${lifiError.message || error.message}`);
            }

            throw new Error(`Failed to get LI.FI quote: ${(error as Error).message}`);
        }
    }

    async buildTransaction(
        chain: SupportedChain,
        config: SwapInputConfig,
        quote?: SwapQuote
    ): Promise<SwapTransaction> {
        logger.debug({ chain, config }, 'Building LI.FI transaction');

        try {
            // LI.FI includes transaction data in the quote response
            // If we have a quote with rawQuote data, use it directly
            // Note: The 'from' field should be the Safe address (recipient) for Safe transactions
            const fromAddress = config.recipient || config.walletAddress;
            
            if (quote?.rawQuote?.transactionRequest) {
                const txRequest = quote.rawQuote.transactionRequest;

                return {
                    to: txRequest.to,
                    from: fromAddress, // Use Safe address if available
                    data: txRequest.data,
                    value: txRequest.value || '0',
                    gasLimit: config.gasLimit || txRequest.gasLimit || '500000',
                    maxFeePerGas: config.maxFeePerGas || txRequest.maxFeePerGas,
                    maxPriorityFeePerGas: config.maxPriorityFeePerGas || txRequest.maxPriorityFeePerGas,
                    chainId: CHAIN_CONFIGS[chain].chainId,
                };
            }

            // If no quote provided, fetch a new one to get transaction data
            const freshQuote = await this.getQuote(chain, config);

            if (!freshQuote.rawQuote?.transactionRequest) {
                throw new Error('LI.FI did not return transaction data');
            }

            const txRequest = freshQuote.rawQuote.transactionRequest;

            const transaction: SwapTransaction = {
                to: txRequest.to,
                from: fromAddress, // Use Safe address if available
                data: txRequest.data,
                value: txRequest.value || '0',
                gasLimit: config.gasLimit || txRequest.gasLimit || '500000',
                maxFeePerGas: config.maxFeePerGas || txRequest.maxFeePerGas,
                maxPriorityFeePerGas: config.maxPriorityFeePerGas || txRequest.maxPriorityFeePerGas,
                chainId: CHAIN_CONFIGS[chain].chainId,
            };

            logger.debug({ transaction }, 'LI.FI transaction built');
            return transaction;
        } catch (error) {
            logger.error({ error, chain, config }, 'Failed to build LI.FI transaction');
            throw new Error(`Failed to build LI.FI transaction: ${(error as Error).message}`);
        }
    }

    async simulateTransaction(
        chain: SupportedChain,
        transaction: SwapTransaction
    ): Promise<{ success: boolean; gasEstimate?: string; error?: string }> {
        try {
            const provider = getProvider(chain);

            const gasEstimate = await provider.estimateGas({
                to: transaction.to,
                from: transaction.from,
                data: transaction.data,
                value: transaction.value,
            });

            logger.debug({ gasEstimate: gasEstimate.toString() }, 'LI.FI simulation successful');

            return {
                success: true,
                gasEstimate: gasEstimate.toString(),
            };
        } catch (error) {
            logger.error({ error }, 'LI.FI simulation failed');
            return {
                success: false,
                error: (error as Error).message,
            };
        }
    }

    async validateConfig(
        chain: SupportedChain,
        config: SwapInputConfig
    ): Promise<{ valid: boolean; errors?: string[] }> {
        const errors: string[] = [];

        if (!this.supportsChain(chain)) {
            errors.push(`LI.FI does not support chain: ${chain}`);
        }

        if (!config.sourceToken.address || config.sourceToken.address.length !== 42) {
            errors.push('Invalid source token address');
        }

        if (!config.destinationToken.address || config.destinationToken.address.length !== 42) {
            errors.push('Invalid destination token address');
        }

        if (config.sourceToken.address.toLowerCase() === config.destinationToken.address.toLowerCase()) {
            errors.push('Source and destination tokens cannot be the same');
        }

        if (!config.amount || BigInt(config.amount) <= BigInt(0)) {
            errors.push('Invalid swap amount');
        }

        if (!config.walletAddress || config.walletAddress.length !== 42) {
            errors.push('Invalid wallet address');
        }

        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
        };
    }

    /**
     * Get supported tokens for a specific chain from LI.FI
     */
    async getTokens(chain: SupportedChain): Promise<any[]> {
        try {
            const chainConfig = CHAIN_CONFIGS[chain];

            const response = await axios.get(
                `${this.apiUrl}/tokens`,
                {
                    params: {
                        chains: chainConfig.chainId,
                    },
                    headers: this.getHeaders(),
                    timeout: 10000,
                }
            );

            return response.data.tokens?.[chainConfig.chainId] || [];
        } catch (error) {
            logger.error({ error, chain }, 'Failed to get LI.FI tokens');
            return [];
        }
    }

    /**
     * Get transaction status from LI.FI
     */
    async getTransactionStatus(txHash: string, chain: SupportedChain): Promise<any> {
        try {
            const chainConfig = CHAIN_CONFIGS[chain];

            const response = await axios.get(
                `${this.apiUrl}/status`,
                {
                    params: {
                        txHash,
                        fromChain: chainConfig.chainId,
                        toChain: chainConfig.chainId,
                    },
                    headers: this.getHeaders(),
                    timeout: 10000,
                }
            );

            return response.data;
        } catch (error) {
            logger.error({ error, txHash, chain }, 'Failed to get LI.FI transaction status');
            return null;
        }
    }

    // Private helper methods

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Accept': 'application/json',
        };

        if (this.apiKey) {
            headers['x-lifi-api-key'] = this.apiKey;
        }

        return headers;
    }

    private extractRoute(quoteData: any): string[] {
        try {
            // LI.FI provides includedSteps with tool information
            const steps = quoteData.includedSteps || [];
            return steps.map((step: any) => step.toolDetails?.name || step.tool || 'Unknown');
        } catch {
            return [];
        }
    }

    private calculatePriceImpact(estimate: any): string {
        try {
            // Calculate price impact from fromAmountUSD and toAmountUSD
            const fromUsd = parseFloat(estimate.fromAmountUSD || '0');
            const toUsd = parseFloat(estimate.toAmountUSD || '0');

            if (fromUsd > 0 && toUsd > 0) {
                const impact = ((fromUsd - toUsd) / fromUsd) * 100;
                return impact.toFixed(2);
            }
            return '0';
        } catch {
            return '0';
        }
    }

    private extractGasEstimate(estimate: any): string {
        try {
            // Sum up gas estimates from all steps
            const gasCosts = estimate.gasCosts || [];
            let totalGas = BigInt(0);

            for (const cost of gasCosts) {
                if (cost.estimate) {
                    totalGas += BigInt(cost.estimate);
                }
            }

            return totalGas > 0 ? totalGas.toString() : '300000';
        } catch {
            return '300000';
        }
    }
}
