import {
  SwapProvider,
  SupportedChain,
  SwapInputConfig,
  SwapQuote,
  SwapTransaction,
} from '../../../types';

/**
 * Base interface for all swap providers
 * Each provider (Uniswap, Relay, 1inch) implements this interface
 */
export interface ISwapProvider {
  /**
   * Get provider name
   */
  getName(): SwapProvider;

  /**
   * Check if provider supports a specific chain
   */
  supportsChain(chain: SupportedChain): boolean;

  /**
   * Get a quote for a swap
   * @param chain - The blockchain to execute on
   * @param config - Swap input configuration
   * @returns Promise<SwapQuote>
   */
  getQuote(
    chain: SupportedChain,
    config: SwapInputConfig
  ): Promise<SwapQuote>;

  /**
   * Build transaction data for a swap
   * @param chain - The blockchain to execute on
   * @param config - Swap input configuration
   * @param quote - Optional quote from getQuote
   * @returns Promise<SwapTransaction>
   */
  buildTransaction(
    chain: SupportedChain,
    config: SwapInputConfig,
    quote?: SwapQuote
  ): Promise<SwapTransaction>;

  /**
   * Simulate a swap transaction (dry run)
   * @param chain - The blockchain to execute on
   * @param transaction - The transaction to simulate
   * @returns Promise<boolean> - Success status
   */
  simulateTransaction(
    chain: SupportedChain,
    transaction: SwapTransaction
  ): Promise<{
    success: boolean;
    gasEstimate?: string;
    error?: string;
  }>;

  /**
   * Validate swap configuration
   * @param chain - The blockchain to execute on
   * @param config - Swap input configuration
   * @returns Promise<ValidationResult>
   */
  validateConfig(
    chain: SupportedChain,
    config: SwapInputConfig
  ): Promise<{
    valid: boolean;
    errors?: string[];
  }>;
}

/**
 * Swap provider factory
 * Returns the appropriate provider based on the provider type
 */
export interface ISwapProviderFactory {
  getProvider(provider: SwapProvider): ISwapProvider;
  getAllProviders(): ISwapProvider[];
  getProvidersForChain(chain: SupportedChain): ISwapProvider[];
}

