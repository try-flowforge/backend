import { SwapProvider, SupportedChain } from '../../../types';
import { ISwapProvider, ISwapProviderFactory } from '../interfaces/ISwapProvider';
import { UniswapProvider } from './UniswapProvider';
import { RelayProvider } from './RelayProvider';
import { OneInchProvider } from './OneInchProvider';
import { logger } from '../../../utils/logger';

/**
 * Factory for creating and managing swap providers
 * Implements the Factory pattern for swap provider instantiation
 */
export class SwapProviderFactory implements ISwapProviderFactory {
  private providers: Map<SwapProvider, ISwapProvider>;

  constructor() {
    this.providers = new Map();
    this.initializeProviders();
  }

  /**
   * Initialize all available providers
   */
  private initializeProviders(): void {
    logger.info('Initializing swap providers...');

    try {
      this.providers.set(SwapProvider.UNISWAP, new UniswapProvider());
      this.providers.set(SwapProvider.RELAY, new RelayProvider());
      this.providers.set(SwapProvider.ONEINCH, new OneInchProvider());

      logger.info(
        { providerCount: this.providers.size },
        'Swap providers initialized'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to initialize swap providers');
      throw error;
    }
  }

  /**
   * Get a specific provider by type
   */
  getProvider(provider: SwapProvider): ISwapProvider {
    const swapProvider = this.providers.get(provider);

    if (!swapProvider) {
      throw new Error(`Swap provider not found: ${provider}`);
    }

    return swapProvider;
  }

  /**
   * Get all available providers
   */
  getAllProviders(): ISwapProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get providers that support a specific chain
   */
  getProvidersForChain(chain: SupportedChain): ISwapProvider[] {
    return this.getAllProviders().filter(provider =>
      provider.supportsChain(chain)
    );
  }

  /**
   * Check if a provider is available
   */
  hasProvider(provider: SwapProvider): boolean {
    return this.providers.has(provider);
  }

  /**
   * Get best provider for a specific chain
   * Can be extended with logic to choose based on liquidity, fees, etc.
   */
  getBestProviderForChain(chain: SupportedChain): ISwapProvider | null {
    const availableProviders = this.getProvidersForChain(chain);

    if (availableProviders.length === 0) {
      return null;
    }

    // For now, return the first available provider
    // In production, you might want to:
    // 1. Get quotes from all providers
    // 2. Compare prices and fees
    // 3. Return the provider with best rate
    return availableProviders[0];
  }
}

// Export singleton instance
export const swapProviderFactory = new SwapProviderFactory();

