import { SupportedChain } from '../types/swap.types';
import { OracleProvider } from '../types/oracle.types';

/**
 * Oracle Price Feed Configuration
 * Pre-configured price feed addresses and IDs for easy selection
 */

export interface PriceFeedInfo {
  symbol: string; // e.g., "ETH/USD"
  name: string; // e.g., "Ethereum / US Dollar"
  category: 'crypto' | 'forex' | 'commodities' | 'indices';
  chainlink?: Partial<Record<SupportedChain, string>>; // Aggregator addresses per chain
  pyth?: string; // Pyth price feed ID (universal across chains)
}

/**
 * Supported price feeds with their addresses/IDs
 * Sources:
 * - Chainlink: https://docs.chain.link/data-feeds/price-feeds/addresses
 * - Pyth: https://pyth.network/developers/price-feed-ids
 */
export const PRICE_FEEDS: Record<string, PriceFeedInfo> = {
  'ETH/USD': {
    symbol: 'ETH/USD',
    name: 'Ethereum / US Dollar',
    category: 'crypto',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
      [SupportedChain.ARBITRUM_SEPOLIA]: '0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165',
    },
    pyth: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  },
  'BTC/USD': {
    symbol: 'BTC/USD',
    name: 'Bitcoin / US Dollar',
    category: 'crypto',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0x6ce185860a4963106506C203335A2910413708e9',
      [SupportedChain.ARBITRUM_SEPOLIA]: '0x56a43EB56Da12C0dc1D972ACb089c06a5dEF8e69',
    },
    pyth: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  },
  'USDC/USD': {
    symbol: 'USDC/USD',
    name: 'USD Coin / US Dollar',
    category: 'crypto',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
      [SupportedChain.ARBITRUM_SEPOLIA]: '0x0153002d20B96532C639313c2d54c3dA09109309',
    },
    pyth: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  },
  'USDT/USD': {
    symbol: 'USDT/USD',
    name: 'Tether / US Dollar',
    category: 'crypto',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7',
      // Note: USDT/USD may not be available on Sepolia
    },
    pyth: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  },
  'LINK/USD': {
    symbol: 'LINK/USD',
    name: 'Chainlink / US Dollar',
    category: 'crypto',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0x86E53CF1B870786351Da77A57575e79CB55812CB',
      [SupportedChain.ARBITRUM_SEPOLIA]: '0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298',
    },
    pyth: '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221',
  },
  'ARB/USD': {
    symbol: 'ARB/USD',
    name: 'Arbitrum / US Dollar',
    category: 'crypto',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6',
      [SupportedChain.ARBITRUM_SEPOLIA]: '0xD1092a65338d049DB68D7Be6bD89d17a0929945e',
    },
    pyth: '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5',
  },
  'SOL/USD': {
    symbol: 'SOL/USD',
    name: 'Solana / US Dollar',
    category: 'crypto',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0x24ceA4b8ce57cdA5058b924B9B9987992450590c',
    },
    pyth: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  },
  'MATIC/USD': {
    symbol: 'MATIC/USD',
    name: 'Polygon / US Dollar',
    category: 'crypto',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0x52099D4523531f678Dfc568a7B1e5038aadcE1d6',
    },
    pyth: '0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52',
  },
  'AVAX/USD': {
    symbol: 'AVAX/USD',
    name: 'Avalanche / US Dollar',
    category: 'crypto',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0x8bf61728eeDCE2F32c456454d87B5d6eD6150208',
    },
    pyth: '0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7',
  },
  'EUR/USD': {
    symbol: 'EUR/USD',
    name: 'Euro / US Dollar',
    category: 'forex',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0xA14d53bC1F1c0F31B4aA3BD109344E5009051a84',
    },
    pyth: '0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b',
  },
  'GBP/USD': {
    symbol: 'GBP/USD',
    name: 'British Pound / US Dollar',
    category: 'forex',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0x9C4424Fd84C6661F97D8d6b3fc3C1aAc2BeDd137',
    },
    pyth: '0x84c2dde9633d93d1bcad84e7dc41c9d56578b7ec52fabedc1f335d673df0a7c1',
  },
  'JPY/USD': {
    symbol: 'JPY/USD',
    name: 'Japanese Yen / US Dollar',
    category: 'forex',
    chainlink: {
      [SupportedChain.ARBITRUM]: '0x3dD6e51CB9caE717d5a8778CF79A04029f9cFDF8',
    },
    pyth: '0xef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52',
  },
  'XAU/USD': {
    symbol: 'XAU/USD',
    name: 'Gold / US Dollar',
    category: 'commodities',
    pyth: '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
  },
  'XAG/USD': {
    symbol: 'XAG/USD',
    name: 'Silver / US Dollar',
    category: 'commodities',
    pyth: '0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e',
  },
};

/**
 * Get all available price feeds
 */
export function getAllPriceFeeds(): PriceFeedInfo[] {
  return Object.values(PRICE_FEEDS);
}

/**
 * Get price feeds available for a specific provider and chain
 */
export function getPriceFeedsForChain(
  provider: OracleProvider,
  chain: SupportedChain
): PriceFeedInfo[] {
  return Object.values(PRICE_FEEDS).filter((feed) => {
    if (provider === OracleProvider.CHAINLINK) {
      return feed.chainlink && feed.chainlink[chain];
    } else if (provider === OracleProvider.PYTH) {
      return feed.pyth !== undefined;
    }
    return false;
  });
}

/**
 * Get a specific price feed configuration
 */
export function getPriceFeed(symbol: string): PriceFeedInfo | undefined {
  return PRICE_FEEDS[symbol];
}

/**
 * Get the Chainlink aggregator address for a specific feed and chain
 */
export function getChainlinkAddress(
  symbol: string,
  chain: SupportedChain
): string | undefined {
  const feed = PRICE_FEEDS[symbol];
  return feed?.chainlink?.[chain];
}

/**
 * Get the Pyth price feed ID for a specific symbol
 */
export function getPythPriceId(symbol: string): string | undefined {
  const feed = PRICE_FEEDS[symbol];
  return feed?.pyth;
}

/**
 * Get price feeds by category
 */
export function getPriceFeedsByCategory(
  category: 'crypto' | 'forex' | 'commodities' | 'indices'
): PriceFeedInfo[] {
  return Object.values(PRICE_FEEDS).filter((feed) => feed.category === category);
}

