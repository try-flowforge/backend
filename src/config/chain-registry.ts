/**
 * ============================================================
 * CHAIN REGISTRY — Single source of truth for chain configuration
 * ============================================================
 *
 * Mirrors the frontend's chain-registry.ts pattern.
 * Every other file should import chain information from here.
 *
 * Two complementary concepts live in this file:
 *
 *   1. **ChainId** – The string enum members (e.g. "ARBITRUM").
 *      Used by swap / lending / oracle services, types, and DB records.
 *
 *   2. **NumericChainId** – The EVM integer chain ID (e.g. 42161).
 *      Used by the Safe / relay layer and on-chain interactions.
 *
 * Both are derivable from the central CHAIN_REGISTRY.
 */

import * as dotenv from "dotenv";
dotenv.config();

export const Chains = {
    ARBITRUM: "ARBITRUM",
    ARBITRUM_SEPOLIA: "ARBITRUM_SEPOLIA",
} as const;

export type ChainId = (typeof Chains)[keyof typeof Chains];

export const NUMERIC_CHAIN_IDS = {
    ARBITRUM: 42161,
    ARBITRUM_SEPOLIA: 421614,
} as const;

/**
 * Union of every numeric chain ID the backend supports.
 * Replaces the old `SupportedChainId` type.
 */
export type NumericChainId = (typeof NUMERIC_CHAIN_IDS)[keyof typeof NUMERIC_CHAIN_IDS];

/**
 * Numeric chain IDs where Safe relay flows are supported.
 * Keep this explicit so relay endpoints never silently expand to unsupported chains.
 */
export const SAFE_RELAY_CHAIN_IDS = [
    NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA,
    NUMERIC_CHAIN_IDS.ARBITRUM,
] as const;

export type SafeRelayNumericChainId = (typeof SAFE_RELAY_CHAIN_IDS)[number];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface ChainContracts {
    // Uniswap
    uniswapRouter?: string;
    uniswapFactory?: string;
    weth?: string;
    uniswapV4Quoter?: string;
    uniswapV4PoolSwapTest?: string;
    universalRouter?: string;
    permit2?: string;
    // Aave V3
    aavePool?: string;
    aavePoolDataProvider?: string;
    aaveWethGateway?: string;
    // Compound V3
    compoundComet?: string;
    compoundConfigurator?: string;
}

// Chain registry entry (full info for a single chain)
export interface ChainRegistryEntry {
    /** Internal string identifier, e.g. "ARBITRUM" */
    id: ChainId;
    /** EVM numeric chain ID */
    chainId: NumericChainId;
    /** Human-readable name */
    name: string;
    /** Primary RPC URL */
    rpcUrl: string;
    /** Block explorer URL */
    explorerUrl: string;
    /** Whether this is a testnet */
    isTestnet: boolean;
    /** Native currency info */
    nativeCurrency: {
        name: string;
        symbol: string;
        decimals: number;
    };
    /** DeFi contract addresses */
    contracts: ChainContracts;
    /** Safe wallet factory address (for relay / onboarding) */
    safeFactoryAddress: string;
    /** Safe module address (for relay / onboarding) */
    safeModuleAddress: string;
}

function env(key: string, fallback = ""): string {
    return process.env[key] || fallback;
}

function safeFactory(numericId: number): string {
    return (
        process.env[`SAFE_WALLET_FACTORY_ADDRESS_${numericId}`] ||
        process.env.SAFE_WALLET_FACTORY_ADDRESS ||
        ""
    );
}

function safeModule(numericId: number): string {
    return (
        process.env[`SAFE_MODULE_ADDRESS_${numericId}`] ||
        process.env.SAFE_MODULE_ADDRESS ||
        ""
    );
}

export const CHAIN_REGISTRY: ChainRegistryEntry[] = [
    {
        id: Chains.ARBITRUM,
        chainId: NUMERIC_CHAIN_IDS.ARBITRUM,
        name: "Arbitrum One",
        rpcUrl: env("ARBITRUM_RPC_URL", "https://arb1.arbitrum.io/rpc"),
        explorerUrl: "https://arbiscan.io",
        isTestnet: false,
        nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
        contracts: {
            uniswapRouter: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
            uniswapFactory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
            weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
            uniswapV4Quoter: "0x3972c00f7ed4885e145823eb7c655375d275a1c5",
            uniswapV4PoolSwapTest: "0x0",
            universalRouter: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
            permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
            aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            aavePoolDataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
            aaveWethGateway: "0xB5Ee21786D28c5Ba61661550879475976B707099",
            compoundComet: "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA",
            compoundConfigurator: "0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3",
        },
        safeFactoryAddress: safeFactory(NUMERIC_CHAIN_IDS.ARBITRUM),
        safeModuleAddress: safeModule(NUMERIC_CHAIN_IDS.ARBITRUM),
    },
    {
        id: Chains.ARBITRUM_SEPOLIA,
        chainId: NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA,
        name: "Arbitrum Sepolia",
        rpcUrl: env("ARBITRUM_SEPOLIA_RPC_URL", "https://sepolia-rollup.arbitrum.io/rpc"),
        explorerUrl: "https://sepolia.arbiscan.io",
        isTestnet: true,
        nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
        contracts: {
            uniswapRouter: "0x101F443B4d1b059569D643917553c771E1b9663E",
            uniswapFactory: "0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e",
            weth: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",
            uniswapV4Quoter: "0x7de51022d70a725b508085468052e25e22b5c4c9",
            uniswapV4PoolSwapTest: "0xf3a39c86dbd13c45365e57fb90fe413371f65af8",
            universalRouter: "0xefd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47",
            permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
            aavePool: "0x0",
            aavePoolDataProvider: "0x0",
            aaveWethGateway: "0x0",
            compoundComet: "0x0",
            compoundConfigurator: "0x0",
        },
        safeFactoryAddress: safeFactory(NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA),
        safeModuleAddress: safeModule(NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA),
    },
];

/** Get a chain entry by its string id OR numeric chain ID */
export function getChain(identifier: string | number): ChainRegistryEntry | undefined {
    if (typeof identifier === "number") {
        return CHAIN_REGISTRY.find((c) => c.chainId === identifier);
    }
    return CHAIN_REGISTRY.find((c) => c.id === identifier);
}

/** Get a chain entry — throws if not found (for required lookups) */
export function getChainOrThrow(identifier: string | number): ChainRegistryEntry {
    const chain = getChain(identifier);
    if (!chain) throw new Error(`Unsupported chain: ${identifier}`);
    return chain;
}

/** Get all registered chains */
export function getAllChains(): ChainRegistryEntry[] {
    return [...CHAIN_REGISTRY];
}

/** Check if a string identifier is a valid chain id */
export function isValidChainId(id: string): id is ChainId {
    return CHAIN_REGISTRY.some((c) => c.id === id);
}

/** Check if a numeric chain ID is supported */
export function isSupportedNumericChainId(numericId: number): numericId is NumericChainId {
    return CHAIN_REGISTRY.some((c) => c.chainId === numericId);
}

/** Check if a numeric chain id belongs to a mainnet (non-testnet) chain */
export function isMainnetChain(numericId: number): boolean {
    const chain = getChain(numericId);
    return chain ? !chain.isTestnet : false;
}

/** Get numeric chain IDs of all active chains */
export function getActiveNumericChainIds(): NumericChainId[] {
    return CHAIN_REGISTRY.map((c) => c.chainId);
}

/** Get string chain IDs of all active chains */
export function getActiveChainIds(): ChainId[] {
    return CHAIN_REGISTRY.map((c) => c.id);
}

/** Convert between string ↔ numeric chain id */
export function numericToStringId(numericId: number): ChainId | undefined {
    return getChain(numericId)?.id;
}

export function stringToNumericId(stringId: string): number | undefined {
    return getChain(stringId)?.chainId;
}

/** Check if a Safe contract address is configured (non-empty and non-zero). */
export function isConfiguredSafeAddress(address: string): boolean {
    return Boolean(address) && address.toLowerCase() !== ZERO_ADDRESS;
}

/** Check whether a chain has both Safe factory + module configured. */
export function hasSafeRelayContracts(chain: ChainRegistryEntry): boolean {
    return (
        isConfiguredSafeAddress(chain.safeFactoryAddress) &&
        isConfiguredSafeAddress(chain.safeModuleAddress)
    );
}

/** Check if numeric chain ID is allowed for Safe relay endpoints. */
export function isSafeRelayChainId(numericId: number): numericId is SafeRelayNumericChainId {
    return SAFE_RELAY_CHAIN_IDS.includes(numericId as SafeRelayNumericChainId);
}

/** Get numeric chain IDs allowed for Safe relay endpoints. */
export function getSafeRelayChainIds(): SafeRelayNumericChainId[] {
    return [...SAFE_RELAY_CHAIN_IDS];
}

/** Get relay-safe chain entries (regardless of runtime Safe address configuration). */
export function getSafeRelayChains(): ChainRegistryEntry[] {
    return SAFE_RELAY_CHAIN_IDS.map((chainId) => getChainOrThrow(chainId));
}

/** Human-readable labels for Safe relay chain IDs. */
export function getSafeRelayChainLabels(): string[] {
    return getSafeRelayChains().map((chain) => `${chain.chainId} (${chain.name})`);
}

/**
 * Get Safe relay chain config and assert Safe contracts are configured.
 * Throws when chain is unsupported for relay flows or contracts are missing.
 */
export function getSafeRelayChainOrThrow(numericId: number): ChainRegistryEntry {
    if (!isSafeRelayChainId(numericId)) {
        throw new Error(`Unsupported Safe relay chain ID: ${numericId}`);
    }

    const chain = getChainOrThrow(numericId);
    if (!hasSafeRelayContracts(chain)) {
        throw new Error(
            `Safe relay contracts are not configured for chain ${chain.name} (${chain.chainId})`
        );
    }

    return chain;
}

/**
 * Backward-compatible CHAIN_CONFIGS keyed by string ChainId.
 * Replaces the old `CHAIN_CONFIGS` in config/chains.ts.
 */
export const CHAIN_CONFIGS: Record<string, ChainRegistryEntry> = Object.fromEntries(
    CHAIN_REGISTRY.map((entry) => [entry.id, entry])
);

/**
 * Backward-compatible numeric keyed configs.
 * Replaces the old `chainConfigs` in config/config.ts.
 */
export const CHAIN_CONFIGS_BY_NUMERIC_ID: Record<number, ChainRegistryEntry> = Object.fromEntries(
    CHAIN_REGISTRY.map((entry) => [entry.chainId, entry])
);
