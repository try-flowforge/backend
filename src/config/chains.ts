/**
 * Chain Configurations and Provider Configs
 *
 * This file now re-exports chain data from the central chain-registry
 * and adds provider-specific, security, validation, and gas configs.
 */

import {
  Chains,
  type ChainId,
  type ChainRegistryEntry,
  CHAIN_CONFIGS,
  isValidChainId,
  getAllChains,
} from "./chain-registry";

// Re-export so existing consumers (`CHAIN_CONFIGS`, `getChainConfig`, etc.) still work
export { Chains, CHAIN_CONFIGS, getAllChains, isValidChainId };
export type { ChainId, ChainRegistryEntry };

import { SupportedChain } from "../types/swap.types";
export { SupportedChain };

export const PROVIDER_CONFIGS = {
  LIFI: {
    apiUrl: process.env.LIFI_API_URL || "https://li.quest/v1",
    apiKey: process.env.LIFI_API_KEY,
    integratorId: process.env.LIFI_INTEGRATOR_ID || "agentic-workflow",
    defaultSlippage: 0.5,
  },
};

export const RPC_CONFIG = {
  fallbackRpcs: {
    [SupportedChain.ARBITRUM]: [
      "https://arb1.arbitrum.io/rpc",
      process.env.ARBITRUM_RPC_FALLBACK_1,
      process.env.ARBITRUM_RPC_FALLBACK_2,
    ].filter(Boolean) as string[],
    [SupportedChain.ARBITRUM_SEPOLIA]: [
      "https://sepolia-rollup.arbitrum.io/rpc",
      process.env.ARBITRUM_SEPOLIA_RPC_FALLBACK_1,
      process.env.ARBITRUM_SEPOLIA_RPC_FALLBACK_2,
    ].filter(Boolean) as string[],
  },
};

export const GAS_CONFIG = {
  maxPriorityFeePerGas: {
    [SupportedChain.ARBITRUM]: "100000000",
    [SupportedChain.ARBITRUM_SEPOLIA]: "100000000",
  },
  maxFeePerGas: {
    [SupportedChain.ARBITRUM]: "500000000",
    [SupportedChain.ARBITRUM_SEPOLIA]: "1000000000",
  },
  gasLimitMultiplier: 1.2,
};

export const SECURITY_CONFIG = {
  maxSlippageTolerance: 5,
  minSwapIntervalMs: 10000,
  maxSwapAmountUsd: 100000,
  defaultDeadlineMinutes: 20,
  maxDeadlineMinutes: 60,
  rateLimits: {
    swapPerHour: 100,
    swapPerDay: 500,
    workflowExecutionPerHour: 1000,
  },
};

export const VALIDATION_CONFIG = {
  minTokenAddressLength: 42,
  maxTokenAddressLength: 42,
  minSwapAmount: "1",
  minSlippage: 0.01,
  maxSlippage: SECURITY_CONFIG.maxSlippageTolerance,
  minGasLimit: "21000",
  maxGasLimit: "10000000",
};

/**
 * Get chain config by SupportedChain string enum.
 * Returns the ChainRegistryEntry (which is a superset of the old ChainConfig).
 */
export const getChainConfig = (chain: SupportedChain | string): ChainRegistryEntry => {
  const config = CHAIN_CONFIGS[chain];
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return config;
};

/** Get RPC URL with fallback support */
export const getRpcUrl = (chain: SupportedChain, fallbackIndex: number = 0): string => {
  const fallbacks = RPC_CONFIG.fallbackRpcs[chain];
  if (!fallbacks || fallbacks.length === 0) {
    throw new Error(`No RPC URL configured for chain: ${chain}`);
  }
  const index = Math.min(fallbackIndex, fallbacks.length - 1);
  return fallbacks[index];
};

/** Validate chain support */
export const isSupportedChain = (chain: string): chain is SupportedChain => {
  return Object.values(SupportedChain).includes(chain as SupportedChain);
};

/** Get chain by numeric chain ID */
export const getChainByChainId = (chainId: number): SupportedChain | null => {
  for (const [key, config] of Object.entries(CHAIN_CONFIGS)) {
    if (config.chainId === chainId) {
      return key as SupportedChain;
    }
  }
  return null;
};
