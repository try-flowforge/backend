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

