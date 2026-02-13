import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

export {
  Chains,
  type ChainId,
  NUMERIC_CHAIN_IDS,
  type NumericChainId,
  type ChainRegistryEntry,
  type ChainContracts,
  CHAIN_REGISTRY,
  CHAIN_CONFIGS,
  CHAIN_CONFIGS_BY_NUMERIC_ID,
  getChain,
  getChainOrThrow,
  getAllChains,
  isValidChainId,
  isSupportedNumericChainId,
  isMainnetChain,
  getActiveNumericChainIds,
  getActiveChainIds,
  numericToStringId,
  stringToNumericId,
} from "./chain-registry";

import {
  NUMERIC_CHAIN_IDS,
  getChainOrThrow,
} from "./chain-registry";

/**
 * Centralized configuration for the backend
 * All environment variables are loaded and validated here
 */

// Helper function to get required env var or throw error
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

// Helper function to get optional env var with default
function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

// Helper function to get optional number env var with default
function getOptionalNumberEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(
      `Environment variable ${key} must be a valid number, got: ${value}`
    );
  }
  return parsed;
}

/**
 * Server Configuration
 */
export const serverConfig = {
  port: getOptionalNumberEnv("PORT", 3000),
  nodeEnv: getOptionalEnv("NODE_ENV", "development"),
  apiVersion: getOptionalEnv("API_VERSION", "v1"),
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment:
    process.env.NODE_ENV === "development" || !process.env.NODE_ENV,
} as const;

/**
 * Database Configuration
 */
export const dbConfig = {
  host: getOptionalEnv("DB_HOST", "localhost"),
  port: getOptionalNumberEnv("DB_PORT", 5432),
  database: getOptionalEnv("DB_NAME", "agentic_workflow"),
  user: getOptionalEnv("DB_USER", "postgres"),
  password: getOptionalEnv("DB_PASSWORD", "postgres"),
  poolMin: getOptionalNumberEnv("DB_POOL_MIN", 1),
  poolMax: getOptionalNumberEnv("DB_POOL_MAX", 5),
} as const;

/**
 * Redis Configuration
 */
export const redisConfig = {
  host: getOptionalEnv("REDIS_HOST", "localhost"),
  port: getOptionalNumberEnv("REDIS_PORT", 6379),
  password: process.env.REDIS_PASSWORD, // Optional
} as const;

/**
 * Privy Authentication Configuration
 */
export const privyConfig = {
  appId: getRequiredEnv("PRIVY_APP_ID"),
  appSecret: getRequiredEnv("PRIVY_APP_SECRET"),
} as const;

/**
 * Encryption Configuration
 */
export const encryptionConfig = {
  key: getRequiredEnv("ENCRYPTION_KEY"),
} as const;

/**
 * Relayer Configuration
 */
export const relayerConfig = {
  relayerPrivateKey: getRequiredEnv("RELAYER_PRIVATE_KEY"),
} as const;

/**
 * @deprecated Import from chain-registry instead.
 * Kept for backward compatibility with existing consumers.
 */
export const SUPPORTED_CHAINS = {
  ETHEREUM_SEPOLIA: NUMERIC_CHAIN_IDS.ETHEREUM_SEPOLIA,
  ARBITRUM_SEPOLIA: NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA,
  ARBITRUM_MAINNET: NUMERIC_CHAIN_IDS.ARBITRUM,
  BASE_MAINNET: NUMERIC_CHAIN_IDS.BASE,
} as const;

/**
 * @deprecated Use NumericChainId from chain-registry instead.
 */
export type SupportedChainId =
  | typeof SUPPORTED_CHAINS.ETHEREUM_SEPOLIA
  | typeof SUPPORTED_CHAINS.ARBITRUM_SEPOLIA
  | typeof SUPPORTED_CHAINS.ARBITRUM_MAINNET
  | typeof SUPPORTED_CHAINS.BASE_MAINNET;

/**
 * Old ChainConfig interface from config.ts — mapped to ChainRegistryEntry.
 * @deprecated Use ChainRegistryEntry from chain-registry.
 */
export interface OldChainConfig {
  chainId: SupportedChainId;
  rpcUrl: string;
  factoryAddress: string;
  moduleAddress: string;
  name: string;
}

/**
 * Backward-compatible chainConfigs keyed by numeric chain id.
 * Maps to the old shape (factoryAddress, moduleAddress).
 */
export const chainConfigs: Record<SupportedChainId, OldChainConfig> = {
  [SUPPORTED_CHAINS.ETHEREUM_SEPOLIA]: (() => {
    const c = getChainOrThrow(NUMERIC_CHAIN_IDS.ETHEREUM_SEPOLIA);
    return { chainId: c.chainId as SupportedChainId, rpcUrl: c.rpcUrl, factoryAddress: c.safeFactoryAddress, moduleAddress: c.safeModuleAddress, name: c.name };
  })(),
  [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: (() => {
    const c = getChainOrThrow(NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA);
    return { chainId: c.chainId as SupportedChainId, rpcUrl: c.rpcUrl, factoryAddress: c.safeFactoryAddress, moduleAddress: c.safeModuleAddress, name: c.name };
  })(),
  [SUPPORTED_CHAINS.ARBITRUM_MAINNET]: (() => {
    const c = getChainOrThrow(NUMERIC_CHAIN_IDS.ARBITRUM);
    return { chainId: c.chainId as SupportedChainId, rpcUrl: c.rpcUrl, factoryAddress: c.safeFactoryAddress, moduleAddress: c.safeModuleAddress, name: c.name };
  })(),
  [SUPPORTED_CHAINS.BASE_MAINNET]: (() => {
    const c = getChainOrThrow(NUMERIC_CHAIN_IDS.BASE);
    return { chainId: c.chainId as SupportedChainId, rpcUrl: c.rpcUrl, factoryAddress: c.safeFactoryAddress, moduleAddress: c.safeModuleAddress, name: c.name };
  })(),
};

/**
 * @deprecated Use getChainOrThrow from chain-registry.
 */
export function getChainConfig(chainId: number): OldChainConfig {
  if (chainId in chainConfigs) {
    return chainConfigs[chainId as SupportedChainId];
  }
  throw new Error(`Unsupported chain ID: ${chainId}`);
}

/**
 * @deprecated Use isSupportedNumericChainId from chain-registry.
 */
export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return chainId in chainConfigs;
}

/**
 * @deprecated Use getActiveNumericChainIds from chain-registry.
 */
export function getActiveChains(): SupportedChainId[] {
  return Object.keys(chainConfigs).map(Number) as SupportedChainId[];
}

/**
 * @deprecated Use safeFactoryAddress / safeModuleAddress from chain-registry entry directly.
 */
export const safeConfig = {
  factoryAddress11155111: chainConfigs[SUPPORTED_CHAINS.ETHEREUM_SEPOLIA].factoryAddress,
  moduleAddress11155111: chainConfigs[SUPPORTED_CHAINS.ETHEREUM_SEPOLIA].moduleAddress,
  factoryAddress421614: chainConfigs[SUPPORTED_CHAINS.ARBITRUM_SEPOLIA].factoryAddress,
  moduleAddress421614: chainConfigs[SUPPORTED_CHAINS.ARBITRUM_SEPOLIA].moduleAddress,
  factoryAddress42161: chainConfigs[SUPPORTED_CHAINS.ARBITRUM_MAINNET].factoryAddress,
  moduleAddress42161: chainConfigs[SUPPORTED_CHAINS.ARBITRUM_MAINNET].moduleAddress,
} as const;

/**
 * Rate Limiting Configuration
 */
export const rateLimitConfig = {
  maxTxsPerUserPerDay: getOptionalNumberEnv(
    "RELAY_MAX_TXS_PER_USER_PER_DAY",
    5
  ),
} as const;

/**
 * ENS subdomain sponsorship: 3 sponsored txs per 0.5 USDC (per 1 week period).
 */
export const SPONSORED_TXS_PER_PERIOD = 3;
export const ENS_PRICER_PERIOD_SECONDS = 7 * 24 * 3600; // 604800

/**
 * ENS chain IDs
 */
export const ENS_CHAIN_IDS = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,
} as const;

export type EnsChainId =
  | typeof ENS_CHAIN_IDS.ETHEREUM_MAINNET
  | typeof ENS_CHAIN_IDS.ETHEREUM_SEPOLIA;

/**
 * ENS Configuration
 */
export const ensConfig: Partial<
  Record<
    EnsChainId,
    { registryAddress: string; pricerAddress: string; rpcUrl?: string }
  >
> = {
  [ENS_CHAIN_IDS.ETHEREUM_MAINNET]: {
    registryAddress: getOptionalEnv("SUBDOMAIN_REGISTRY_ADDRESS_1", ""),
    pricerAddress: getOptionalEnv("PRICER_ADDRESS_1", ""),
    rpcUrl: process.env.ETHEREUM_MAINNET_RPC_URL,
  },
  [ENS_CHAIN_IDS.ETHEREUM_SEPOLIA]: {
    registryAddress: getOptionalEnv("SUBDOMAIN_REGISTRY_ADDRESS_11155111", ""),
    pricerAddress: getOptionalEnv("PRICER_ADDRESS_11155111", ""),
    rpcUrl: process.env.ETHEREUM_SEPOLIA_RPC_URL,
  },
};

/**
 * Complete configuration object
 */
export const config = {
  server: serverConfig,
  database: dbConfig,
  redis: redisConfig,
  privy: privyConfig,
  encryption: encryptionConfig,
  relayer: relayerConfig,
  chains: chainConfigs,
  safe: safeConfig,
  rateLimit: rateLimitConfig,
} as const;

/**
 * Validate configuration on module load
 */
export function validateConfig(): void {
  if (!relayerConfig.relayerPrivateKey.startsWith("0x")) {
    throw new Error("RELAYER_PRIVATE_KEY must start with 0x");
  }

  if (relayerConfig.relayerPrivateKey.length !== 66) {
    throw new Error(
      "RELAYER_PRIVATE_KEY must be 66 characters (0x + 64 hex chars)"
    );
  }

  // Validate encryption key
  if (encryptionConfig.key.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate with: openssl rand -hex 32"
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(encryptionConfig.key)) {
    throw new Error("ENCRYPTION_KEY must be a valid hexadecimal string");
  }

  // Validate all chain configurations
  for (const [chainId, chainConfig] of Object.entries(chainConfigs)) {
    if (!chainConfig.rpcUrl.startsWith("http")) {
      throw new Error(
        `RPC URL for chain ${chainId} must be a valid HTTP/HTTPS URL`
      );
    }

    if (chainConfig.factoryAddress && !chainConfig.factoryAddress.startsWith("0x")) {
      throw new Error(
        `Factory address for chain ${chainId} must be a valid Ethereum address`
      );
    }

    if (chainConfig.moduleAddress && !chainConfig.moduleAddress.startsWith("0x")) {
      throw new Error(
        `Module address for chain ${chainId} must be a valid Ethereum address`
      );
    }
  }
}

// Validate on module load
try {
  validateConfig();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Configuration validation failed:", message);
  throw error;
}

export default config;
