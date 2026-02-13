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
    BASE: "BASE",
    ETHEREUM: "ETHEREUM",
    ETHEREUM_SEPOLIA: "ETHEREUM_SEPOLIA",
    UNICHAIN: "UNICHAIN",
    UNICHAIN_SEPOLIA: "UNICHAIN_SEPOLIA",
} as const;

export type ChainId = (typeof Chains)[keyof typeof Chains];

export const NUMERIC_CHAIN_IDS = {
    ETHEREUM: 1,
    ETHEREUM_SEPOLIA: 11155111,
    ARBITRUM: 42161,
    ARBITRUM_SEPOLIA: 421614,
    BASE: 8453,
    UNICHAIN: 130,
    UNICHAIN_SEPOLIA: 1301,
} as const;

/**
 * Union of every numeric chain ID the backend supports.
 * Replaces the old `SupportedChainId` type.
 */
export type NumericChainId = (typeof NUMERIC_CHAIN_IDS)[keyof typeof NUMERIC_CHAIN_IDS];

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
    chainId: number;
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
    {
        id: Chains.BASE,
        chainId: NUMERIC_CHAIN_IDS.BASE,
        name: "Base",
        rpcUrl: env("BASE_RPC_URL", "https://mainnet.base.org"),
        explorerUrl: "https://basescan.org",
        isTestnet: false,
        nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
        contracts: {
            weth: "0x4200000000000000000000000000000000000006",
        },
        safeFactoryAddress: safeFactory(NUMERIC_CHAIN_IDS.BASE) || "0x0000000000000000000000000000000000000000",
        safeModuleAddress: safeModule(NUMERIC_CHAIN_IDS.BASE) || "0x0000000000000000000000000000000000000000",
    },
    {
        id: Chains.ETHEREUM,
        chainId: NUMERIC_CHAIN_IDS.ETHEREUM,
        name: "Ethereum",
        rpcUrl: env("ETHEREUM_RPC_URL", "https://eth.llamarpc.com"),
        explorerUrl: "https://etherscan.io",
        isTestnet: false,
        nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
        contracts: {
            uniswapRouter: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
            uniswapFactory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
            weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            uniswapV4Quoter: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
            uniswapV4PoolSwapTest: "0x0",
            universalRouter: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
            permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
            aavePool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
            aavePoolDataProvider: "0x0",
            aaveWethGateway: "0x0",
            compoundComet: "0x0",
            compoundConfigurator: "0x0",
        },
        safeFactoryAddress: "",
        safeModuleAddress: "",
    },
    {
        id: Chains.ETHEREUM_SEPOLIA,
        chainId: NUMERIC_CHAIN_IDS.ETHEREUM_SEPOLIA,
        name: "Ethereum Sepolia",
        rpcUrl: env("ETHEREUM_SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
        explorerUrl: "https://sepolia.etherscan.io",
        isTestnet: true,
        nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
        contracts: {
            uniswapRouter: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
            uniswapFactory: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
            weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
            uniswapV4Quoter: "0x61b3f2011a92d183c7dbadbda940a7555ccf9227",
            uniswapV4PoolSwapTest: "0x9b6b46e2c869aa39918db7f52f5557fe577b6eee",
            universalRouter: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
            permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
            aavePool: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
            aavePoolDataProvider: "0x3e9708d80f7B3e43118013075F7e95CE3AB31F31",
            aaveWethGateway: "0x387d311e47e80b498169e6fb51d3193167d89f7d",
            compoundComet: "0x0",
            compoundConfigurator: "0x0",
        },
        safeFactoryAddress: safeFactory(NUMERIC_CHAIN_IDS.ETHEREUM_SEPOLIA),
        safeModuleAddress: safeModule(NUMERIC_CHAIN_IDS.ETHEREUM_SEPOLIA),
    },
    {
        id: Chains.UNICHAIN,
        chainId: NUMERIC_CHAIN_IDS.UNICHAIN,
        name: "Unichain",
        rpcUrl: env("UNICHAIN_RPC_URL", "https://mainnet.unichain.org"),
        explorerUrl: "https://uniscan.xyz",
        isTestnet: false,
        nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
        contracts: {
            weth: "0x0",
            uniswapV4Quoter: "0x333e3c607b141b18ff6de9f258db6e77fe7491e0",
            uniswapV4PoolSwapTest: "0x0",
            universalRouter: "0xef740bf23acae26f6492b10de645d6b98dc8eaf3",
            permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
            uniswapRouter: "0x0",
            uniswapFactory: "0x0",
            aavePool: "0x0",
            aavePoolDataProvider: "0x0",
            aaveWethGateway: "0x0",
            compoundComet: "0x0",
            compoundConfigurator: "0x0",
        },
        safeFactoryAddress: "",
        safeModuleAddress: "",
    },
    {
        id: Chains.UNICHAIN_SEPOLIA,
        chainId: NUMERIC_CHAIN_IDS.UNICHAIN_SEPOLIA,
        name: "Unichain Sepolia",
        rpcUrl: env("UNICHAIN_SEPOLIA_RPC_URL", "https://sepolia.unichain.org"),
        explorerUrl: "https://sepolia.uniscan.xyz",
        isTestnet: true,
        nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
        contracts: {
            weth: "0x0",
            uniswapV4Quoter: "0x56dcd40a3f2d466f48e7f48bdbe5cc9b92ae4472",
            uniswapV4PoolSwapTest: "0x9140a78c1a137c7ff1c151ec8231272af78a99a4",
            universalRouter: "0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d",
            permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
            uniswapRouter: "0x0",
            uniswapFactory: "0x0",
            aavePool: "0x0",
            aavePoolDataProvider: "0x0",
            aaveWethGateway: "0x0",
            compoundComet: "0x0",
            compoundConfigurator: "0x0",
        },
        safeFactoryAddress: "",
        safeModuleAddress: "",
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
export function isSupportedNumericChainId(numericId: number): boolean {
    return CHAIN_REGISTRY.some((c) => c.chainId === numericId);
}

/** Check if a numeric chain id belongs to a mainnet (non-testnet) chain */
export function isMainnetChain(numericId: number): boolean {
    const chain = getChain(numericId);
    return chain ? !chain.isTestnet : false;
}

/** Get numeric chain IDs of all active chains */
export function getActiveNumericChainIds(): number[] {
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

/**
 * @deprecated Use ChainRegistryEntry instead. This alias exists for
 * backward compatibility with code that imported ChainConfig from
 * types/swap.types.ts
 */
export type ChainConfig = ChainRegistryEntry;

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
