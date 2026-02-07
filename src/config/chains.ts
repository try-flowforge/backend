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
      uniswapV4Quoter: '0x3972c00f7ed4885e145823eb7c655375d275a1c5', // Uniswap V4 Quoter (docs.uniswap.org/contracts/v4/deployments)
      uniswapV4PoolSwapTest: '0x0', // Mainnet: use Universal Router for execution
      universalRouter: '0xa51afafe0263b40edaef0df8781ea9aa03e381a3', // Uniswap Universal Router (Arbitrum)
      permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3', // Permit2 (same on all chains)
      // Aave V3
      aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      aavePoolDataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
      aaveWethGateway: '0xB5Ee21786D28c5Ba61661550879475976B707099',
      // Compound V3
      compoundComet: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA', // cUSDCv3
      compoundConfigurator: '0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3',
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
      uniswapV4Quoter: '0x7de51022d70a725b508085468052e25e22b5c4c9', // Uniswap V4 Quoter (Arbitrum Sepolia)
      uniswapV4PoolSwapTest: '0xf3a39c86dbd13c45365e57fb90fe413371f65af8', // Uniswap V4 PoolSwapTest
      universalRouter: '0xefd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47', // Uniswap Universal Router (Arbitrum Sepolia)
      permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      // Aave V3 (not deployed on Arbitrum Sepolia)
      aavePool: '0x0',
      aavePoolDataProvider: '0x0',
      aaveWethGateway: '0x0',
      // Compound V3 (not available on Sepolia yet)
      compoundComet: '0x0',
      compoundConfigurator: '0x0',
    },
  },
  [SupportedChain.BASE]: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      weth: '0x4200000000000000000000000000000000000006',
      // No Uniswap/Aave/Compound required for LiFi-only use
    },
  },
  [SupportedChain.ETHEREUM]: {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      uniswapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3 SwapRouter02
      uniswapFactory: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Uniswap V3 Factory
      weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on Ethereum
      uniswapV4Quoter: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203', // Uniswap V4 Quoter (Ethereum mainnet)
      uniswapV4PoolSwapTest: '0x0', // Mainnet: use Universal Router for execution
      universalRouter: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', // Uniswap Universal Router (Ethereum)
      permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      aavePool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      aavePoolDataProvider: '0x0',
      aaveWethGateway: '0x0',
      compoundComet: '0x0',
      compoundConfigurator: '0x0',
    },
  },
  [SupportedChain.ETHEREUM_SEPOLIA]: {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    rpcUrl: process.env.ETHEREUM_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    explorerUrl: 'https://sepolia.etherscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      uniswapRouter: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E', // Uniswap V3 SwapRouter02 on Sepolia
      uniswapFactory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c', // Uniswap V3 Factory on Sepolia
      weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // WETH on Sepolia
      uniswapV4Quoter: '0x61b3f2011a92d183c7dbadbda940a7555ccf9227', // Uniswap V4 Quoter
      uniswapV4PoolSwapTest: '0x9b6b46e2c869aa39918db7f52f5557fe577b6eee', // Uniswap V4 PoolSwapTest
      universalRouter: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b', // Uniswap Universal Router (Sepolia)
      permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      // Aave V3 on Ethereum Sepolia
      aavePool: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951', // Aave V3 Pool on Sepolia
      aavePoolDataProvider: '0x3e9708d80f7B3e43118013075F7e95CE3AB31F31', // Aave V3 Pool Data Provider
      aaveWethGateway: '0x387d311e47e80b498169e6fb51d3193167d89f7d', // WETH Gateway on Sepolia
      // Compound V3 (not available on Ethereum Sepolia)
      compoundComet: '0x0',
      compoundConfigurator: '0x0',
    },
  },
  [SupportedChain.UNICHAIN]: {
    chainId: 130,
    name: 'Unichain',
    rpcUrl: process.env.UNICHAIN_RPC_URL || 'https://mainnet.unichain.org',
    explorerUrl: 'https://uniscan.xyz',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      weth: '0x0', // Set per Unichain canonical WETH if needed
      uniswapV4Quoter: '0x333e3c607b141b18ff6de9f258db6e77fe7491e0', // Uniswap V4 Quoter (Unichain 130)
      uniswapV4PoolSwapTest: '0x0', // Mainnet: use Universal Router for execution
      universalRouter: '0xef740bf23acae26f6492b10de645d6b98dc8eaf3', // Uniswap Universal Router (Unichain)
      permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      uniswapRouter: '0x0',
      uniswapFactory: '0x0',
      aavePool: '0x0',
      aavePoolDataProvider: '0x0',
      aaveWethGateway: '0x0',
      compoundComet: '0x0',
      compoundConfigurator: '0x0',
    },
  },
  [SupportedChain.UNICHAIN_SEPOLIA]: {
    chainId: 1301,
    name: 'Unichain Sepolia',
    rpcUrl: process.env.UNICHAIN_SEPOLIA_RPC_URL || 'https://sepolia.unichain.org',
    explorerUrl: 'https://sepolia.uniscan.xyz',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      weth: '0x0', // Set per Unichain Sepolia canonical WETH if needed
      uniswapV4Quoter: '0x56dcd40a3f2d466f48e7f48bdbe5cc9b92ae4472', // Uniswap V4 Quoter (Unichain Sepolia 1301)
      uniswapV4PoolSwapTest: '0x9140a78c1a137c7ff1c151ec8231272af78a99a4', // Uniswap V4 PoolSwapTest
      universalRouter: '0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d', // Uniswap Universal Router (Unichain Sepolia)
      permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      uniswapRouter: '0x0',
      uniswapFactory: '0x0',
      aavePool: '0x0',
      aavePoolDataProvider: '0x0',
      aaveWethGateway: '0x0',
      compoundComet: '0x0',
      compoundConfigurator: '0x0',
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
  LIFI: {
    apiUrl: process.env.LIFI_API_URL || 'https://li.quest/v1',
    apiKey: process.env.LIFI_API_KEY,
    integratorId: process.env.LIFI_INTEGRATOR_ID || 'agentic-workflow',
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
    [SupportedChain.ETHEREUM]: [
      'https://eth.llamarpc.com',
      process.env.ETHEREUM_RPC_URL,
      process.env.ETHEREUM_RPC_FALLBACK_1,
    ].filter(Boolean) as string[],
    [SupportedChain.ARBITRUM_SEPOLIA]: [
      'https://sepolia-rollup.arbitrum.io/rpc',
      process.env.ARBITRUM_SEPOLIA_RPC_FALLBACK_1,
      process.env.ARBITRUM_SEPOLIA_RPC_FALLBACK_2,
    ].filter(Boolean) as string[],
    [SupportedChain.BASE]: [
      'https://mainnet.base.org',
      process.env.BASE_RPC_URL,
    ].filter(Boolean) as string[],
    [SupportedChain.ETHEREUM_SEPOLIA]: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://eth-sepolia.public.blastapi.io',
      'https://rpc.sepolia.org',
      process.env.ETHEREUM_SEPOLIA_RPC_URL,
    ].filter(Boolean) as string[],
    [SupportedChain.UNICHAIN]: [
      'https://mainnet.unichain.org',
      process.env.UNICHAIN_RPC_URL,
    ].filter(Boolean) as string[],
    [SupportedChain.UNICHAIN_SEPOLIA]: [
      'https://sepolia.unichain.org',
      process.env.UNICHAIN_SEPOLIA_RPC_URL,
    ].filter(Boolean) as string[],
  },
};

// Gas Configuration
export const GAS_CONFIG = {
  maxPriorityFeePerGas: {
    [SupportedChain.ARBITRUM]: '100000000', // 0.1 gwei
    [SupportedChain.ARBITRUM_SEPOLIA]: '100000000', // 0.1 gwei
    [SupportedChain.BASE]: '100000000',
    [SupportedChain.ETHEREUM]: '2000000000', // 2 gwei
    [SupportedChain.ETHEREUM_SEPOLIA]: '2000000000', // 2 gwei
    [SupportedChain.UNICHAIN]: '100000000',
    [SupportedChain.UNICHAIN_SEPOLIA]: '100000000',
  },
  maxFeePerGas: {
    [SupportedChain.ARBITRUM]: '500000000', // 0.5 gwei
    [SupportedChain.ARBITRUM_SEPOLIA]: '1000000000', // 1 gwei
    [SupportedChain.BASE]: '1000000000',
    [SupportedChain.ETHEREUM]: '50000000000', // 50 gwei
    [SupportedChain.ETHEREUM_SEPOLIA]: '50000000000', // 50 gwei
    [SupportedChain.UNICHAIN]: '1000000000',
    [SupportedChain.UNICHAIN_SEPOLIA]: '1000000000',
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

