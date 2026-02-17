import { Request, Response } from 'express';
import { getSafeRelayChains } from '../config/chain-registry';
import { ApiResponse } from '../types';
import { logger } from '../utils/logger';
import { llmServiceClient } from '../services/llm/llm-service-client';

/**
 * Meta Controller
 * Provides runtime configuration and system metadata
 */
export class MetaController {
  /**
   * GET /api/v1/meta/runtime-config
   * Returns runtime configuration and active chains
   */
  static async getRuntimeConfig(_req: Request, res: Response): Promise<void> {
    try {
      const safeRelayChains = getSafeRelayChains();
      const activeChains = safeRelayChains.map((chain) => chain.chainId);

      // Build chain configs for frontend validation
      const chainDetails = safeRelayChains.map((config) => {
        return {
          chainId: config.chainId,
          name: config.name,
          factoryAddress: config.safeFactoryAddress,
          moduleAddress: config.safeModuleAddress,
          rpcUrl: config.rpcUrl,
        };
      });

      // Fetch LLM models (cached in llmServiceClient)
      let llmModels: any[] = [];
      try {
        llmModels = await llmServiceClient.listModels();
        logger.debug({ modelCount: llmModels.length }, 'LLM models fetched for runtime config');
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to fetch LLM models, continuing without them'
        );
        // Don't fail the entire request if LLM service is unavailable
      }
      
      const response: ApiResponse = {
        success: true,
        data: {
          activeChains: activeChains,
          chainDetails: chainDetails,
          llmModels: llmModels,
          timestamp: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      logger.info({ activeChains, llmModels }, 'Runtime config requested');

      res.status(200).json(response);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to get runtime config'
      );

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve runtime configuration',
      });
    }
  }
}
