import { JsonRpcProvider, FallbackProvider, Network } from 'ethers';
import { SupportedChain } from '../types';
import { CHAIN_CONFIGS, RPC_CONFIG } from './chains';
import { logger } from '../utils/logger';

// Provider cache to reuse connections
const providerCache = new Map<SupportedChain, JsonRpcProvider | FallbackProvider>();

/**
 * Get or create an Ethers provider for a specific chain
 * Uses fallback providers for reliability
 */
export const getProvider = (chain: SupportedChain): JsonRpcProvider | FallbackProvider => {
  // Return cached provider if available
  if (providerCache.has(chain)) {
    return providerCache.get(chain)!;
  }

  const chainConfig = CHAIN_CONFIGS[chain];
  const network = new Network(chainConfig.name, chainConfig.chainId);

  // Create fallback provider with multiple RPC endpoints
  const rpcUrls = RPC_CONFIG.fallbackRpcs[chain];
  
  if (rpcUrls.length === 1) {
    // Single RPC endpoint
    const provider = new JsonRpcProvider(rpcUrls[0], network, {
      staticNetwork: network,
      batchMaxCount: 10,
    });
    
    providerCache.set(chain, provider);
    logger.info({ chain, rpc: rpcUrls[0] }, 'Created single RPC provider');
    return provider;
  }

  // Multiple RPC endpoints - use FallbackProvider
  const providers = rpcUrls.map((url, index) => ({
    provider: new JsonRpcProvider(url, network, {
      staticNetwork: network,
      batchMaxCount: 10,
    }),
    priority: index,
    stallTimeout: 2000,
    weight: 1,
  }));

  const fallbackProvider = new FallbackProvider(providers, network);
  providerCache.set(chain, fallbackProvider);
  
  logger.info(
    { chain, rpcCount: rpcUrls.length },
    'Created fallback RPC provider'
  );
  
  return fallbackProvider;
};

/**
 * Test provider connectivity
 */
export const testProviderConnection = async (
  chain: SupportedChain
): Promise<boolean> => {
  try {
    const provider = getProvider(chain);
    const blockNumber = await provider.getBlockNumber();
    
    logger.info(
      { chain, blockNumber },
      'Provider connection test successful'
    );
    
    return true;
  } catch (error) {
    logger.error(
      { chain, error },
      'Provider connection test failed'
    );
    return false;
  }
};

/**
 * Get current gas prices for a chain
 */
export const getGasPrice = async (chain: SupportedChain) => {
  const provider = getProvider(chain);
  const feeData = await provider.getFeeData();
  
  return {
    maxFeePerGas: feeData.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
    gasPrice: feeData.gasPrice?.toString(),
  };
};

/**
 * Get current block number
 */
export const getBlockNumber = async (chain: SupportedChain): Promise<number> => {
  const provider = getProvider(chain);
  return await provider.getBlockNumber();
};

/**
 * Get transaction receipt
 */
export const getTransactionReceipt = async (
  chain: SupportedChain,
  txHash: string
) => {
  const provider = getProvider(chain);
  return await provider.getTransaction(txHash);
};

/**
 * Wait for transaction confirmation
 */
export const waitForTransaction = async (
  chain: SupportedChain,
  txHash: string,
  confirmations: number = 1
) => {
  const provider = getProvider(chain);
  return await provider.waitForTransaction(txHash, confirmations);
};

/**
 * Estimate gas for a transaction
 */
export const estimateGas = async (
  chain: SupportedChain,
  transaction: {
    to: string;
    from: string;
    data: string;
    value?: string;
  }
) => {
  const provider = getProvider(chain);
  return await provider.estimateGas({
    to: transaction.to,
    from: transaction.from,
    data: transaction.data,
    value: transaction.value || '0',
  });
};

/**
 * Call a contract method (read-only)
 */
export const callContract = async (
  chain: SupportedChain,
  transaction: {
    to: string;
    data: string;
  }
) => {
  const provider = getProvider(chain);
  return await provider.call({
    to: transaction.to,
    data: transaction.data,
  });
};

/**
 * Clear provider cache (useful for testing or reconnection)
 */
export const clearProviderCache = (chain?: SupportedChain) => {
  if (chain) {
    providerCache.delete(chain);
    logger.info({ chain }, 'Cleared provider cache for chain');
  } else {
    providerCache.clear();
    logger.info('Cleared all provider caches');
  }
};

/**
 * Initialize and test all providers
 */
export const initializeProviders = async (): Promise<void> => {
  logger.info('Initializing blockchain providers...');
  
  const chains = Object.values(SupportedChain);
  const results = await Promise.allSettled(
    chains.map(chain => testProviderConnection(chain))
  );
  
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  logger.info(
    { successful, failed, total: chains.length },
    'Provider initialization complete'
  );
  
  if (failed === chains.length) {
    throw new Error('All provider connections failed');
  }
};

