import { Request, Response } from 'express';
import { ApiResponse } from '../types';
import { OracleProvider } from '../types/oracle.types';
import { SupportedChain } from '../types/swap.types';
import {
  getAllPriceFeeds,
  getPriceFeedsForChain,
  getPriceFeed,
  getChainlinkAddress,
  getPythPriceId,
  getPriceFeedsByCategory,
  PriceFeedInfo,
} from '../config/oracle-feeds';
import { logger } from '../utils/logger';

/**
 * Oracle Controller
 * Provides oracle price feed configurations and metadata
 */
export class OracleController {
  /**
   * Get all available price feeds
   * GET /api/v1/oracle/feeds
   */
  static async getAllFeeds(req: Request, res: Response): Promise<void> {
    try {
      const { category, provider, chain } = req.query;

      let feeds: PriceFeedInfo[] = getAllPriceFeeds();

      // Filter by category if provided
      if (category && typeof category === 'string') {
        const validCategories = ['crypto', 'forex', 'commodities', 'indices'];
        if (validCategories.includes(category)) {
          feeds = getPriceFeedsByCategory(
            category as 'crypto' | 'forex' | 'commodities' | 'indices'
          );
        }
      }

      // Filter by provider and chain if provided
      if (provider && chain && typeof provider === 'string' && typeof chain === 'string') {
        if (
          provider === OracleProvider.CHAINLINK ||
          provider === OracleProvider.PYTH
        ) {
          feeds = getPriceFeedsForChain(
            provider as OracleProvider,
            chain as SupportedChain
          );
        }
      }

      const response: ApiResponse = {
        success: true,
        data: {
          feeds,
          total: feeds.length,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error({ error }, 'Failed to get price feeds');
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to get price feeds',
          code: 'ORACLE_FEEDS_ERROR',
        },
      });
    }
  }

  /**
   * Get a specific price feed configuration
   * GET /api/v1/oracle/feeds/:symbol
   */
  static async getFeedBySymbol(req: Request, res: Response): Promise<void> {
    try {
      const symbol = Array.isArray(req.params.symbol)
        ? req.params.symbol[0]
        : req.params.symbol;
      if (!symbol) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Symbol parameter is required',
            code: 'MISSING_SYMBOL',
          },
        });
        return;
      }
      const { provider, chain } = req.query;

      const feed = getPriceFeed(symbol);

      if (!feed) {
        res.status(404).json({
          success: false,
          error: {
            message: `Price feed not found for symbol: ${symbol}`,
            code: 'FEED_NOT_FOUND',
          },
        });
        return;
      }

      // Enrich with specific address/ID if provider and chain are specified
      let enrichedFeed: any = { ...feed };

      if (
        provider === OracleProvider.CHAINLINK &&
        chain &&
        typeof chain === 'string'
      ) {
        const address = getChainlinkAddress(symbol, chain as SupportedChain);
        enrichedFeed.address = address;
        enrichedFeed.available = !!address;
      } else if (provider === OracleProvider.PYTH) {
        const priceId = getPythPriceId(symbol);
        enrichedFeed.priceId = priceId;
        enrichedFeed.available = !!priceId;
      }

      const response: ApiResponse = {
        success: true,
        data: enrichedFeed,
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error({ error, symbol: req.params.symbol }, 'Failed to get price feed');
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to get price feed',
          code: 'ORACLE_FEED_ERROR',
        },
      });
    }
  }

  /**
   * Get supported oracle providers
   * GET /api/v1/oracle/providers
   */
  static async getProviders(_req: Request, res: Response): Promise<void> {
    try {
      const providers = [
        {
          id: OracleProvider.CHAINLINK,
          name: 'Chainlink',
          description: 'Decentralized oracle network providing price feeds',
          website: 'https://chain.link',
          docs: 'https://docs.chain.link/data-feeds/price-feeds',
          supportedChains: [SupportedChain.ARBITRUM, SupportedChain.ARBITRUM_SEPOLIA],
        },
        {
          id: OracleProvider.PYTH,
          name: 'Pyth Network',
          description: 'High-fidelity price oracle for financial market data',
          website: 'https://pyth.network',
          docs: 'https://docs.pyth.network/price-feeds',
          supportedChains: [SupportedChain.ARBITRUM, SupportedChain.ARBITRUM_SEPOLIA],
        },
      ];

      const response: ApiResponse = {
        success: true,
        data: {
          providers,
          total: providers.length,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error({ error }, 'Failed to get oracle providers');
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to get oracle providers',
          code: 'ORACLE_PROVIDERS_ERROR',
        },
      });
    }
  }

  /**
   * Get oracle configuration for a specific pair, provider, and chain
   * This is the main endpoint the frontend will use
   * GET /api/v1/oracle/config
   * Query params: symbol, provider, chain
   */
  static async getConfig(req: Request, res: Response): Promise<void> {
    try {
      const { symbol, provider, chain } = req.query;

      if (!symbol || !provider || !chain) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Missing required parameters: symbol, provider, chain',
            code: 'MISSING_PARAMETERS',
          },
        });
        return;
      }

      const feed = getPriceFeed(symbol as string);

      if (!feed) {
        res.status(404).json({
          success: false,
          error: {
            message: `Price feed not found for symbol: ${symbol}`,
            code: 'FEED_NOT_FOUND',
          },
        });
        return;
      }

      let config: any = {
        symbol: feed.symbol,
        name: feed.name,
        category: feed.category,
        provider,
        chain,
      };

      // Add provider-specific configuration
      if (provider === OracleProvider.CHAINLINK) {
        const address = getChainlinkAddress(symbol as string, chain as SupportedChain);
        if (!address) {
          res.status(404).json({
            success: false,
            error: {
              message: `Chainlink feed not available for ${symbol} on ${chain}`,
              code: 'FEED_NOT_AVAILABLE',
            },
          });
          return;
        }
        config.aggregatorAddress = address;
      } else if (provider === OracleProvider.PYTH) {
        const priceId = getPythPriceId(symbol as string);
        if (!priceId) {
          res.status(404).json({
            success: false,
            error: {
              message: `Pyth feed not available for ${symbol}`,
              code: 'FEED_NOT_AVAILABLE',
            },
          });
          return;
        }
        config.priceFeedId = priceId;
      }

      const response: ApiResponse = {
        success: true,
        data: config,
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error({ error, query: req.query }, 'Failed to get oracle config');
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to get oracle configuration',
          code: 'ORACLE_CONFIG_ERROR',
        },
      });
    }
  }
}
