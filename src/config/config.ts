import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

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
  database: getOptionalEnv("DB_NAME", "agentic"),
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
 * Supported Chain IDs
 */
export const SUPPORTED_CHAINS = {
  ETHEREUM_SEPOLIA: 11155111,
  ARBITRUM_SEPOLIA: 421614,
  ARBITRUM_MAINNET: 42161,
  BASE_MAINNET: 8453,
} as const;

export type SupportedChainId =
  | typeof SUPPORTED_CHAINS.ETHEREUM_SEPOLIA
  | typeof SUPPORTED_CHAINS.ARBITRUM_SEPOLIA
  | typeof SUPPORTED_CHAINS.ARBITRUM_MAINNET
  | typeof SUPPORTED_CHAINS.BASE_MAINNET;

/**
 * Chain Configuration
 */
export interface ChainConfig {
  chainId: SupportedChainId;
  rpcUrl: string;
  factoryAddress: string;
  moduleAddress: string;
  name: string;
}

/**
 * Relayer Configuration
 */
export const relayerConfig = {
  relayerPrivateKey: getRequiredEnv("RELAYER_PRIVATE_KEY"),
} as const;

/**
 * Chain-specific configurations
 */
export const chainConfigs: Record<SupportedChainId, ChainConfig> = {
  [SUPPORTED_CHAINS.ETHEREUM_SEPOLIA]: {
    chainId: SUPPORTED_CHAINS.ETHEREUM_SEPOLIA,
    rpcUrl: getRequiredEnv("ETHEREUM_SEPOLIA_RPC_URL"),
    factoryAddress: getRequiredEnv("SAFE_WALLET_FACTORY_ADDRESS_11155111"),
    moduleAddress: getRequiredEnv("SAFE_MODULE_ADDRESS_11155111"),
    name: "Ethereum Sepolia",
  },
  [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: {
    chainId: SUPPORTED_CHAINS.ARBITRUM_SEPOLIA,
    rpcUrl: getRequiredEnv("ARBITRUM_SEPOLIA_RPC_URL"),
    factoryAddress: getRequiredEnv("SAFE_WALLET_FACTORY_ADDRESS_421614"),
    moduleAddress: getRequiredEnv("SAFE_MODULE_ADDRESS_421614"),
    name: "Arbitrum Sepolia",
  },
  [SUPPORTED_CHAINS.ARBITRUM_MAINNET]: {
    chainId: SUPPORTED_CHAINS.ARBITRUM_MAINNET,
    rpcUrl: getRequiredEnv("ARBITRUM_RPC_URL"),
    factoryAddress: getRequiredEnv("SAFE_WALLET_FACTORY_ADDRESS_42161"),
    moduleAddress: getRequiredEnv("SAFE_MODULE_ADDRESS_42161"),
    name: "Arbitrum Mainnet",
  },
  [SUPPORTED_CHAINS.BASE_MAINNET]: {
    chainId: SUPPORTED_CHAINS.BASE_MAINNET,
    rpcUrl: getOptionalEnv("BASE_RPC_URL", "https://mainnet.base.org"),
    factoryAddress: getOptionalEnv("SAFE_WALLET_FACTORY_ADDRESS_8453", "0x0000000000000000000000000000000000000000"),
    moduleAddress: getOptionalEnv("SAFE_MODULE_ADDRESS_8453", "0x0000000000000000000000000000000000000000"),
    name: "Base",
  },
} as const;

/**
 * Helper to get chain config by chain ID
 */
export function getChainConfig(chainId: number): ChainConfig {
  if (chainId === SUPPORTED_CHAINS.ETHEREUM_SEPOLIA) {
    return chainConfigs[SUPPORTED_CHAINS.ETHEREUM_SEPOLIA];
  }
  if (chainId === SUPPORTED_CHAINS.ARBITRUM_SEPOLIA) {
    return chainConfigs[SUPPORTED_CHAINS.ARBITRUM_SEPOLIA];
  }
  if (chainId === SUPPORTED_CHAINS.ARBITRUM_MAINNET) {
    return chainConfigs[SUPPORTED_CHAINS.ARBITRUM_MAINNET];
  }
  if (chainId === SUPPORTED_CHAINS.BASE_MAINNET) {
    return chainConfigs[SUPPORTED_CHAINS.BASE_MAINNET];
  }
  throw new Error(`Unsupported chain ID: ${chainId}`);
}

/**
 * Check if chain ID is supported
 */
export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return (
    chainId === SUPPORTED_CHAINS.ETHEREUM_SEPOLIA ||
    chainId === SUPPORTED_CHAINS.ARBITRUM_SEPOLIA ||
    chainId === SUPPORTED_CHAINS.ARBITRUM_MAINNET ||
    chainId === SUPPORTED_CHAINS.BASE_MAINNET
  );
}

/**
 * Get list of all supported chains
 */
export function getActiveChains(): SupportedChainId[] {
  return [
    SUPPORTED_CHAINS.ETHEREUM_SEPOLIA,
    SUPPORTED_CHAINS.ARBITRUM_SEPOLIA,
    SUPPORTED_CHAINS.ARBITRUM_MAINNET,
    SUPPORTED_CHAINS.BASE_MAINNET,
  ];
}

/**
 * Safe Contract Addresses (deprecated - use chainConfigs instead)
 * @deprecated Use chainConfigs[chainId] instead
 */
export const safeConfig = {
  factoryAddress11155111:
    chainConfigs[SUPPORTED_CHAINS.ETHEREUM_SEPOLIA].factoryAddress,
  moduleAddress11155111:
    chainConfigs[SUPPORTED_CHAINS.ETHEREUM_SEPOLIA].moduleAddress,
  factoryAddress421614:
    chainConfigs[SUPPORTED_CHAINS.ARBITRUM_SEPOLIA].factoryAddress,
  moduleAddress421614:
    chainConfigs[SUPPORTED_CHAINS.ARBITRUM_SEPOLIA].moduleAddress,
  factoryAddress42161:
    chainConfigs[SUPPORTED_CHAINS.ARBITRUM_MAINNET].factoryAddress,
  moduleAddress42161:
    chainConfigs[SUPPORTED_CHAINS.ARBITRUM_MAINNET].moduleAddress,
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
  safe: safeConfig, // For backwards compatibility
  rateLimit: rateLimitConfig,
} as const;

/**
 * Validate configuration on module load
 * This will throw an error if required variables are missing
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

  // Validate it's valid hex
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

    if (!chainConfig.factoryAddress.startsWith("0x")) {
      throw new Error(
        `Factory address for chain ${chainId} must be a valid Ethereum address`
      );
    }

    if (!chainConfig.moduleAddress.startsWith("0x")) {
      throw new Error(
        `Module address for chain ${chainId} must be a valid Ethereum address`
      );
    }
  }
}

// Validate on module load - fail startup if config is invalid
try {
  validateConfig();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Configuration validation failed:", message);
  throw error;
}

export default config;
