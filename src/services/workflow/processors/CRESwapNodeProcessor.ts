import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
  SwapNodeConfig,
  SwapProvider,
  SupportedChain,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { logger } from '../../../utils/logger';
import { creClient, mapSupportedChainToChainName } from '../../cre/CREClient';

type LifiSwapWorkflowConfig = {
  schedule?: string;
  chain: string;
  chainSelectorName: string;
  provider: 'LIFI';
  swapReceiverAddress: string;
  gasLimit: string;
  inputConfig: SwapNodeConfig['inputConfig'];
};

export class CRESwapNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.SWAP;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, 'Executing CRE LI.FI swap node');

    try {
      const config = input.nodeConfig as SwapNodeConfig;

      if (config.provider !== SwapProvider.LIFI) {
        throw new Error(
          `CRESwapNodeProcessor only supports LIFI provider, got ${config.provider}`,
        );
      }

      if (!creClient.isConfigured()) {
        throw new Error('CREClient is not configured; cannot call CRE swap workflow');
      }

      const chainName = mapSupportedChainToChainName(config.chain);

      const workflowConfig: LifiSwapWorkflowConfig = {
        chain: config.chain,
        chainSelectorName: chainName,
        provider: 'LIFI',
        swapReceiverAddress:
          process.env.CRE_LIFI_SWAP_RECEIVER_ADDRESS || '',
        gasLimit: process.env.CRE_LIFI_SWAP_GAS_LIMIT || '1500000',
        inputConfig: config.inputConfig,
      };

      if (!workflowConfig.swapReceiverAddress) {
        throw new Error(
          'CRE_LIFI_SWAP_RECEIVER_ADDRESS is not configured for CRESwapNodeProcessor',
        );
      }

      const result = await creClient.invokeLifiSwap<
        LifiSwapWorkflowConfig,
        {
          success: boolean;
          txHash?: string;
          amountIn: string;
          amountOut?: string;
          error?: string;
        }
      >(workflowConfig);

      const endTime = new Date();

      if (!result.success) {
        return {
          nodeId: input.nodeId,
          success: false,
          output: result,
          error: {
            message: result.error || 'CRE LI.FI swap failed',
            code: 'CRE_LIFI_SWAP_FAILED',
          },
          metadata: {
            startedAt: startTime,
            completedAt: endTime,
            duration: endTime.getTime() - startTime.getTime(),
          },
        };
      }

      const output = {
        provider: SwapProvider.LIFI,
        chain: config.chain,
        txHash: result.txHash,
        amountIn: result.amountIn,
        amountOut: result.amountOut,
      };

      logger.info(
        {
          nodeId: input.nodeId,
          chain: config.chain,
          txHash: result.txHash,
        },
        'CRE LI.FI swap executed successfully',
      );

      return {
        nodeId: input.nodeId,
        success: true,
        output,
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    } catch (error) {
      const endTime = new Date();
      logger.error(
        { error, nodeId: input.nodeId },
        'CRESwapNodeProcessor execution failed',
      );

      return {
        nodeId: input.nodeId,
        success: false,
        output: null,
        error: {
          message: (error as Error).message,
          code: 'CRE_LIFI_SWAP_NODE_ERROR',
          details: error,
        },
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    }
  }

  async validate(config: any): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    if (!config) {
      errors.push('Config is required');
      return { valid: false, errors };
    }

    const swapConfig = config as SwapNodeConfig;

    if (swapConfig.provider !== SwapProvider.LIFI) {
      errors.push('CRESwapNodeProcessor only supports provider=LIFI');
    }

    if (
      !swapConfig.chain ||
      !Object.values(SupportedChain).includes(swapConfig.chain)
    ) {
      errors.push('Invalid or missing chain');
    }

    if (!swapConfig.inputConfig) {
      errors.push('inputConfig is required');
    }

    return { valid: errors.length === 0, errors: errors.length ? errors : undefined };
  }
}

