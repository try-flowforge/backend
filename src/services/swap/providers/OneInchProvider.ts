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
 * 1inch Provider Implementation
 * 1inch is a DEX aggregator that finds best prices across multiple DEXs
 */
export class OneInchProvider implements ISwapProvider {
  private apiKey: string;
  private apiUrl: string;

  constructor() {
    this.apiKey = PROVIDER_CONFIGS.ONEINCH.apiKey || '';
    this.apiUrl = PROVIDER_CONFIGS.ONEINCH.apiUrl;

    if (!this.apiKey) {
      logger.warn('1inch API key not configured');
    }
  }

  getName(): SwapProvider {
    return SwapProvider.ONEINCH;
  }

  supportsChain(chain: SupportedChain): boolean {
    // 1inch supports Arbitrum, limited support for testnets
    return chain === SupportedChain.ARBITRUM;
  }

  async getQuote(
    chain: SupportedChain,
    config: SwapInputConfig
  ): Promise<SwapQuote> {
    logger.debug({ chain, config }, 'Getting 1inch quote');

    try {
      const chainConfig = CHAIN_CONFIGS[chain];

      // 1inch API v6 quote endpoint
      const response = await axios.get(
        `${this.apiUrl}/${chainConfig.chainId}/quote`,
        {
          params: {
            src: config.sourceToken.address,
            dst: config.destinationToken.address,
            amount: config.amount,
          },
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        }
      );

      const quoteData = response.data;

      const quote: SwapQuote = {
        provider: SwapProvider.ONEINCH,
        chain,
        sourceToken: quoteData.srcToken || config.sourceToken,
        destinationToken: quoteData.dstToken || config.destinationToken,
        amountIn: quoteData.fromTokenAmount || config.amount,
        amountOut: quoteData.toTokenAmount,
        estimatedAmountOut: quoteData.toTokenAmount,
        route: quoteData.protocols?.[0]?.map((p: any) => p.name) || [],
        priceImpact: this.calculatePriceImpact(quoteData),
        gasEstimate: quoteData.estimatedGas || '300000',
        estimatedGasCost: '0',
        validUntil: Date.now() + 30000,
        rawQuote: quoteData,
      };

      logger.debug({ quote }, '1inch quote generated');
      return quote;
    } catch (error) {
      logger.error({ error, chain, config }, 'Failed to get 1inch quote');
      throw new Error(`Failed to get 1inch quote: ${(error as Error).message}`);
    }
  }

  async buildTransaction(
    chain: SupportedChain,
    config: SwapInputConfig
  ): Promise<SwapTransaction> {
    logger.debug({ chain, config }, 'Building 1inch transaction');

    try {
      const chainConfig = CHAIN_CONFIGS[chain];
      const slippage = config.slippageTolerance || 0.5;

      // 1inch API v6 swap endpoint
      const response = await axios.get(
        `${this.apiUrl}/${chainConfig.chainId}/swap`,
        {
          params: {
            src: config.sourceToken.address,
            dst: config.destinationToken.address,
            amount: config.amount,
            from: config.walletAddress,
            slippage: slippage,
            disableEstimate: false,
            allowPartialFill: config.enablePartialFill || false,
          },
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        }
      );

      const swapData = response.data;

      const transaction: SwapTransaction = {
        to: swapData.tx.to,
        from: config.walletAddress,
        data: swapData.tx.data,
        value: swapData.tx.value || '0',
        gasLimit: config.gasLimit || swapData.tx.gas || '400000',
        maxFeePerGas: config.maxFeePerGas || swapData.tx.maxFeePerGas,
        maxPriorityFeePerGas: config.maxPriorityFeePerGas || swapData.tx.maxPriorityFeePerGas,
        chainId: chainConfig.chainId,
      };

      logger.debug({ transaction }, '1inch transaction built');
      return transaction;
    } catch (error) {
      logger.error({ error, chain, config }, 'Failed to build 1inch transaction');
      throw new Error(`Failed to build 1inch transaction: ${(error as Error).message}`);
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

      logger.debug({ gasEstimate: gasEstimate.toString() }, '1inch simulation successful');

      return {
        success: true,
        gasEstimate: gasEstimate.toString(),
      };
    } catch (error) {
      logger.error({ error }, '1inch simulation failed');
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

    if (!this.apiKey) {
      errors.push('1inch API key not configured');
    }

    if (!this.supportsChain(chain)) {
      errors.push(`1inch does not support chain: ${chain}`);
    }

    if (!config.sourceToken.address || config.sourceToken.address.length !== 42) {
      errors.push('Invalid source token address');
    }

    if (!config.destinationToken.address || config.destinationToken.address.length !== 42) {
      errors.push('Invalid destination token address');
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

  private calculatePriceImpact(_quoteData: any): string {
    // 1inch doesn't directly provide price impact, calculate if possible
    return '0';
  }
}

