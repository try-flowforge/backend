import { SupportedChain, ChainConfig } from '../types';

// Chain Configurations
export const CHAIN_CONFIGS: Record<SupportedChain, ChainConfig> = {
  [SupportedChain.ARBITRUM]: {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      uniswapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3 SwapRouter02
      uniswapFactory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Uniswap V3 Factory
      weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH on Arbitrum
    },
  },
  [SupportedChain.ARBITRUM_SEPOLIA]: {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    explorerUrl: 'https://sepolia.arbiscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      uniswapRouter: '0x101F443B4d1b059569D643917553c771E1b9663E', // Uniswap V3 SwapRouter02 on Arbitrum Sepolia
      uniswapFactory: '0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e', // Uniswap V3 Factory on Arbitrum Sepolia
      weth: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', // WETH on Arbitrum Sepolia
    },
  },
};

// Provider-specific API configurations
export const PROVIDER_CONFIGS = {
  UNISWAP: {
    // No API key required for on-chain Uniswap
    v2Enabled: true,
    v3Enabled: true,
    defaultSlippage: 0.5, // 0.5%
  },
  RELAY: {
    apiUrl: process.env.RELAY_API_URL || 'https://api.relay.link',
    apiKey: process.env.RELAY_API_KEY,
    defaultSlippage: 0.5,
  },
  ONEINCH: {
    apiUrl: process.env.ONEINCH_API_URL || 'https://api.1inch.dev/swap/v6.0',
    apiKey: process.env.ONEINCH_API_KEY,
    defaultSlippage: 0.5,
  },
};

// RPC Rate Limiting & Fallbacks
export const RPC_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000, // milliseconds
  timeout: 30000, // 30 seconds
  fallbackRpcs: {
    [SupportedChain.ARBITRUM]: [
      'https://arb1.arbitrum.io/rpc',
      process.env.ARBITRUM_RPC_FALLBACK_1,
      process.env.ARBITRUM_RPC_FALLBACK_2,
    ].filter(Boolean) as string[],
    [SupportedChain.ARBITRUM_SEPOLIA]: [
      'https://sepolia-rollup.arbitrum.io/rpc',
      process.env.ARBITRUM_SEPOLIA_RPC_FALLBACK_1,
      process.env.ARBITRUM_SEPOLIA_RPC_FALLBACK_2,
    ].filter(Boolean) as string[],
  },
};

// Gas Configuration
export const GAS_CONFIG = {
  maxPriorityFeePerGas: {
    [SupportedChain.ARBITRUM]: '100000000', // 0.1 gwei
    [SupportedChain.ARBITRUM_SEPOLIA]: '100000000', // 0.1 gwei
  },
  maxFeePerGas: {
    [SupportedChain.ARBITRUM]: '500000000', // 0.5 gwei
    [SupportedChain.ARBITRUM_SEPOLIA]: '1000000000', // 1 gwei
  },
  gasLimitMultiplier: 1.2, // Add 20% buffer to estimated gas
};

// Security Configuration
export const SECURITY_CONFIG = {
  // Maximum allowed slippage (prevents front-running)
  maxSlippageTolerance: 5, // 5%
  
  // Minimum time between same-wallet swaps (anti-spam)
  minSwapIntervalMs: 10000, // 10 seconds
  
  // Maximum swap amount in USD (risk management)
  maxSwapAmountUsd: 100000, // $100k
  
  // Transaction deadline buffer
  defaultDeadlineMinutes: 20,
  maxDeadlineMinutes: 60,
  
  // Rate limiting
  rateLimits: {
    swapPerHour: 100,
    swapPerDay: 500,
    workflowExecutionPerHour: 1000,
  },
};

// Validation Configuration
export const VALIDATION_CONFIG = {
  // Token address validation
  minTokenAddressLength: 42,
  maxTokenAddressLength: 42,
  
  // Amount validation
  minSwapAmount: '1', // Minimum 1 wei
  
  // Slippage validation
  minSlippage: 0.01, // 0.01%
  maxSlippage: SECURITY_CONFIG.maxSlippageTolerance,
  
  // Gas validation
  minGasLimit: '21000',
  maxGasLimit: '10000000',
};

// Helper function to get chain config
export const getChainConfig = (chain: SupportedChain): ChainConfig => {
  const config = CHAIN_CONFIGS[chain];
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return config;
};

// Helper function to get RPC URL with fallback
export const getRpcUrl = (chain: SupportedChain, fallbackIndex: number = 0): string => {
  const fallbacks = RPC_CONFIG.fallbackRpcs[chain];
  if (!fallbacks || fallbacks.length === 0) {
    throw new Error(`No RPC URL configured for chain: ${chain}`);
  }
  
  const index = Math.min(fallbackIndex, fallbacks.length - 1);
  return fallbacks[index];
};

// Helper function to validate chain support
export const isSupportedChain = (chain: string): chain is SupportedChain => {
  return Object.values(SupportedChain).includes(chain as SupportedChain);
};

// Helper function to get chain by ID
export const getChainByChainId = (chainId: number): SupportedChain | null => {
  for (const [key, config] of Object.entries(CHAIN_CONFIGS)) {
    if (config.chainId === chainId) {
      return key as SupportedChain;
    }
  }
  return null;
};

