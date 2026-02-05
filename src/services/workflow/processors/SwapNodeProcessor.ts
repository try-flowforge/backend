import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
  SwapNodeConfig,
  SwapProvider,
  SupportedChain,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { swapExecutionService } from '../../swap/SwapExecutionService';
import { logger } from '../../../utils/logger';
import { pool } from '../../../config/database';

/**
 * Swap Node Processor
 * Handles execution of swap nodes
 */
export class SwapNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.SWAP;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, 'Executing swap node');

    try {
      const config: SwapNodeConfig = input.nodeConfig;

      // Validate configuration
      const validation = await this.validate(config);
      if (!validation.valid) {
        throw new Error(`Invalid swap configuration: ${validation.errors?.join(', ')}`);
      }

      // Get node execution ID from database
      const nodeExecutionId = await this.getNodeExecutionId(
        input.executionContext.executionId,
        input.nodeId
      );

      // Execute the swap via Safe wallet
      // Pass userId to lookup Safe wallet address
      const result = await swapExecutionService.executeSwap(
        nodeExecutionId,
        config.chain,
        config.provider,
        config.inputConfig,
        input.executionContext.userId,
      );

      const endTime = new Date();

      if (!result.success) {
        return {
          nodeId: input.nodeId,
          success: false,
          output: result,
          error: {
            message: result.errorMessage || 'Swap execution failed',
            code: result.errorCode || 'SWAP_FAILED',
          },
          metadata: {
            startedAt: startTime,
            completedAt: endTime,
            duration: endTime.getTime() - startTime.getTime(),
          },
        };
      }

      // Map output if configured
      let output = result;
      if (config.outputMapping) {
        output = this.applyOutputMapping(result, config.outputMapping);
      }

      logger.info({ nodeId: input.nodeId, txHash: result.txHash }, 'Swap node executed successfully');

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
      logger.error({ error, nodeId: input.nodeId }, 'Swap node execution failed');

      return {
        nodeId: input.nodeId,
        success: false,
        output: null,
        error: {
          message: (error as Error).message,
          code: 'SWAP_NODE_ERROR',
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

    // Validate provider
    if (!swapConfig.provider || !Object.values(SwapProvider).includes(swapConfig.provider)) {
      errors.push('Invalid or missing provider');
    }

    // Validate chain
    if (!swapConfig.chain || !Object.values(SupportedChain).includes(swapConfig.chain)) {
      errors.push('Invalid or missing chain');
    }

    // Validate input config
    if (!swapConfig.inputConfig) {
      errors.push('Input config is required');
    } else {
      const inputConfig = swapConfig.inputConfig;

      if (!inputConfig.sourceToken?.address) {
        errors.push('Source token address is required');
      }

      if (!inputConfig.destinationToken?.address) {
        errors.push('Destination token address is required');
      }

      if (!inputConfig.amount) {
        errors.push('Amount is required');
      }

      if (!inputConfig.swapType) {
        errors.push('Swap type is required');
      }

      if (!inputConfig.walletAddress) {
        errors.push('Wallet address is required');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Get node execution ID from database
   */
  private async getNodeExecutionId(
    executionId: string,
    nodeId: string
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM node_executions WHERE execution_id = $1 AND node_id = $2 ORDER BY started_at DESC LIMIT 1',
      [executionId, nodeId]
    );

    if (result.rows.length === 0) {
      throw new Error('Node execution not found');
    }

    return result.rows[0].id;
  }

  /**
   * Apply output mapping to transform output data
   */
  private applyOutputMapping(output: any, mapping: Record<string, string>): any {
    const mapped: any = {};

    for (const [key, path] of Object.entries(mapping)) {
      // Simple path resolution (e.g., "txHash" -> output.txHash)
      const value = this.getValueByPath(output, path);
      mapped[key] = value;
    }

    return { ...output, ...mapped };
  }

  /**
   * Get value from object by path
   */
  private getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

