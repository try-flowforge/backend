import axios from 'axios';
import {
  SwapProvider,
  SupportedChain,
  SwapInputConfig,
  SwapQuote,
  SwapTransaction,
  SwapType,
  TokenInfo,
} from '../../../types';
import { ISwapProvider } from '../interfaces/ISwapProvider';
import { PROVIDER_CONFIGS, CHAIN_CONFIGS } from '../../../config/chains';
import { getProvider } from '../../../config/providers';
import { logger } from '../../../utils/logger';

/**
 * Relay.link Provider Implementation
 * Relay is a cross-chain bridge and swap aggregator
 */
export class RelayProvider implements ISwapProvider {
  private apiKey: string;
  private apiUrl: string;

  constructor() {
    this.apiKey = PROVIDER_CONFIGS.RELAY.apiKey || '';
    this.apiUrl = PROVIDER_CONFIGS.RELAY.apiUrl;

    // API key is optional for Relay - they're developing self-serve provisioning
    if (!this.apiKey) {
      logger.info('Relay: No API key configured (optional - can build immediately without one)');
    }
  }

  getName(): SwapProvider {
    return SwapProvider.RELAY;
  }

  supportsChain(chain: SupportedChain): boolean {
    // Relay supports Arbitrum mainnet and testnet
    return [
      SupportedChain.ARBITRUM,
      SupportedChain.ARBITRUM_SEPOLIA,
    ].includes(chain);
  }

  async getQuote(
    chain: SupportedChain,
    config: SwapInputConfig
  ): Promise<SwapQuote> {
    logger.debug({ chain, config }, 'Getting Relay quote');

    try {
      const chainConfig = CHAIN_CONFIGS[chain];

      // Relay API v2 call
      const headers: any = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await axios.post(`${this.apiUrl}/quote/v2`, {
        user: config.walletAddress,
        originChainId: chainConfig.chainId,
        destinationChainId: chainConfig.chainId, // Same chain swap
        originCurrency: config.sourceToken.address,
        destinationCurrency: config.destinationToken.address,
        amount: config.amount,
        tradeType: config.swapType === SwapType.EXACT_INPUT ? 'EXACT_INPUT' : 'EXACT_OUTPUT',
      }, {
        headers,
        timeout: 10000,
      });

      const quoteData = response.data;

      // Get token info
      const sourceToken = await this.getTokenInfo(chain, config.sourceToken.address);
      const destToken = await this.getTokenInfo(chain, config.destinationToken.address);

      const quote: SwapQuote = {
        provider: SwapProvider.RELAY,
        chain,
        sourceToken,
        destinationToken: destToken,
        amountIn: quoteData.amountIn || config.amount,
        amountOut: quoteData.amountOut,
        estimatedAmountOut: quoteData.estimatedAmountOut || quoteData.amountOut,
        route: quoteData.route || [config.sourceToken.address, config.destinationToken.address],
        priceImpact: quoteData.priceImpact || '0',
        gasEstimate: quoteData.gasEstimate || '300000',
        estimatedGasCost: quoteData.estimatedGasCost || '0',
        validUntil: Date.now() + 30000,
        rawQuote: quoteData,
      };

      logger.debug({ quote }, 'Relay quote generated');
      return quote;
    } catch (error) {
      logger.error({ error, chain, config }, 'Failed to get Relay quote');
      throw new Error(`Failed to get Relay quote: ${(error as Error).message}`);
    }
  }

  async buildTransaction(
    chain: SupportedChain,
    config: SwapInputConfig
  ): Promise<SwapTransaction> {
    logger.debug({ chain, config }, 'Building Relay transaction');

    try {
      const chainConfig = CHAIN_CONFIGS[chain];

      // Relay API v2 call to build transaction
      const headers: any = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await axios.post(
        `${this.apiUrl}/quote/v2`,
        {
          user: config.walletAddress,
          originChainId: chainConfig.chainId,
          destinationChainId: chainConfig.chainId,
          originCurrency: config.sourceToken.address,
          destinationCurrency: config.destinationToken.address,
          amount: config.amount,
          tradeType: config.swapType === SwapType.EXACT_INPUT ? 'EXACT_INPUT' : 'EXACT_OUTPUT',
          recipient: config.recipient || config.walletAddress,
        },
        {
          headers,
          timeout: 10000,
        }
      );

      const txData = response.data;

      const transaction: SwapTransaction = {
        to: txData.to,
        from: config.walletAddress,
        data: txData.data,
        value: txData.value || '0',
        gasLimit: config.gasLimit || txData.gasLimit || '400000',
        maxFeePerGas: config.maxFeePerGas || txData.maxFeePerGas,
        maxPriorityFeePerGas: config.maxPriorityFeePerGas || txData.maxPriorityFeePerGas,
        chainId: chainConfig.chainId,
      };

      logger.debug({ transaction }, 'Relay transaction built');
      return transaction;
    } catch (error) {
      logger.error({ error, chain, config }, 'Failed to build Relay transaction');
      throw new Error(`Failed to build Relay transaction: ${(error as Error).message}`);
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

      logger.debug({ gasEstimate: gasEstimate.toString() }, 'Relay simulation successful');

      return {
        success: true,
        gasEstimate: gasEstimate.toString(),
      };
    } catch (error) {
      logger.error({ error }, 'Relay simulation failed');
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

    // API key is optional for Relay
    // if (!this.apiKey) {
    //   errors.push('Relay API key not configured');
    // }

    if (!this.supportsChain(chain)) {
      errors.push(`Relay does not support chain: ${chain}`);
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

  private async getTokenInfo(_chain: SupportedChain, address: string): Promise<TokenInfo> {
    // For Relay, we might get token info from their API or fallback to on-chain
    return {
      address,
    };
  }
}

