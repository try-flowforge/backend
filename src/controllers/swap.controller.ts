import { Request, Response, NextFunction } from 'express';
import { swapExecutionService } from '../services/swap/SwapExecutionService';
import { swapProviderFactory } from '../services/swap/providers/SwapProviderFactory';
import { logger } from '../utils/logger';
import {
  SwapProvider,
  SupportedChain,
  SwapInputConfig,
  ApiResponse,
} from '../types';

/**
 * Get quote from swap provider
 */
export const getSwapQuote = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { provider, chain } = req.params;
    const config: SwapInputConfig = req.body;

    logger.info({ provider, chain }, 'Getting swap quote');

    const quote = await swapExecutionService.getQuote(
      chain as SupportedChain,
      provider as SwapProvider,
      config
    );

    const response: ApiResponse = {
      success: true,
      data: quote,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Build unsigned transaction for frontend wallet signing
 * Returns the transaction data that the frontend can sign and send
 */
export const buildSwapTransaction = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { provider, chain } = req.params;
    const config: SwapInputConfig = req.body;

    logger.info({ provider, chain }, 'Building swap transaction');

    // Get provider
    const swapProvider = swapProviderFactory.getProvider(provider as SwapProvider);

    // Get quote first
    const quote = await swapProvider.getQuote(chain as SupportedChain, config);

    // Build unsigned transaction
    const transaction = await swapProvider.buildTransaction(
      chain as SupportedChain,
      config,
      quote
    );

    // Simulate if requested (default: true)
    let simulation = null;
    if (config.simulateFirst !== false) {
      simulation = await swapProvider.simulateTransaction(
        chain as SupportedChain,
        transaction
      );

      if (!simulation.success) {
        res.status(400).json({
          success: false,
          error: {
            message: `Simulation failed: ${simulation.error}`,
            code: 'SIMULATION_FAILED',
          },
        } as ApiResponse);
        return;
      }

      // Update gas estimate from simulation
      if (simulation.gasEstimate) {
        transaction.gasLimit = (
          BigInt(simulation.gasEstimate) * BigInt(120) / BigInt(100)
        ).toString(); // Add 20% buffer
      }
    }

    const response: ApiResponse = {
      success: true,
      data: {
        transaction: {
          to: transaction.to,
          data: transaction.data,
          value: transaction.value,
          gasLimit: transaction.gasLimit,
          chainId: transaction.chainId,
        },
        quote: {
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          estimatedAmountOut: quote.estimatedAmountOut,
          priceImpact: quote.priceImpact,
          gasEstimate: quote.gasEstimate,
        },
        simulation: simulation ? {
          success: simulation.success,
          gasEstimate: simulation.gasEstimate,
        } : null,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, 'Failed to build swap transaction');
    next(error);
  }
};

/**
 * Get supported providers for a chain
 */
export const getSupportedProviders = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { chain } = req.params;

    const providers = swapProviderFactory
      .getProvidersForChain(chain as SupportedChain)
      .map((p) => p.getName());

    const response: ApiResponse = {
      success: true,
      data: {
        chain,
        providers,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Get swap execution details
 */
export const getSwapExecution = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const swapExecution = await swapExecutionService.getSwapExecution(id);

    if (!swapExecution) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Swap execution not found',
          code: 'SWAP_EXECUTION_NOT_FOUND',
        },
      } as ApiResponse);
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: swapExecution,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * Get token info from chain
 * Fetches symbol, decimals, and name for a given token address
 */
export const getTokenInfo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const chain = Array.isArray(req.params.chain) ? req.params.chain[0] : req.params.chain;
    const address = Array.isArray(req.params.address) ? req.params.address[0] : req.params.address;

    // Validate address format
    if (!address || address.length !== 42 || !address.startsWith('0x')) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid token address',
          code: 'INVALID_TOKEN_ADDRESS',
        },
      } as ApiResponse);
      return;
    }

    logger.info({ chain, address }, 'Fetching token info');

    // Get provider for the chain
    const { getProvider } = await import('../config/providers');
    const provider = getProvider(chain as SupportedChain);

    // ERC20 ABI for token info
    const { Contract } = await import('ethers');
    const ERC20_ABI = [
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
      'function name() view returns (string)',
    ];

    const token = new Contract(address, ERC20_ABI, provider);

    // Fetch token info (with error handling for each call)
    let symbol = 'UNKNOWN';
    let decimals = 18;
    let name = 'Unknown Token';

    try {
      symbol = await token.symbol();
    } catch {
      logger.warn({ address }, 'Failed to fetch token symbol');
    }

    try {
      decimals = Number(await token.decimals());
    } catch {
      logger.warn({ address }, 'Failed to fetch token decimals');
    }

    try {
      name = await token.name();
    } catch {
      logger.warn({ address }, 'Failed to fetch token name');
    }

    const response: ApiResponse = {
      success: true,
      data: {
        address,
        symbol,
        decimals,
        name,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    logger.error({ error }, 'Failed to fetch token info');
    next(error);
  }
};
