import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
  OracleNodeConfig,
  ChainlinkOracleConfig,
  OracleProvider,
  SupportedChain,
  ChainlinkPriceOutput,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { logger } from '../../../utils/logger';
import { getProvider } from '../../../config/providers';
import { Contract, formatUnits, isAddress } from 'ethers';

const AGGREGATOR_V3_ABI = [
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
];

/**
 * Chainlink Price Oracle Node Processor
 * Fetches data from Chainlink Data Feeds (AggregatorV3Interface)
 */
export class OracleNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.CHAINLINK_PRICE_ORACLE;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, 'Executing price oracle node');

    try {
      const config: OracleNodeConfig = input.nodeConfig;

      const validation = await this.validate(config);
      if (!validation.valid) {
        throw new Error(`Invalid oracle configuration: ${validation.errors?.join(', ')}`);
      }

      // Type guard: ensure this is a Chainlink config
      if (config.provider !== OracleProvider.CHAINLINK) {
        throw new Error(`Invalid provider for Chainlink oracle: ${config.provider}`);
      }

      // Now TypeScript knows this is ChainlinkOracleConfig
      const chainlinkConfig = config as ChainlinkOracleConfig;

      // Chainlink read-only calls via shared provider
      const provider = getProvider(chainlinkConfig.chain);
      const feed = new Contract(chainlinkConfig.aggregatorAddress, AGGREGATOR_V3_ABI, provider);

      const [decimals, description, round] = await Promise.all([
        feed.decimals() as Promise<number>,
        // Some feeds may not implement description consistently; keep it optional.
        feed.description().catch(() => undefined) as Promise<string | undefined>,
        feed.latestRoundData() as Promise<{
          roundId: bigint;
          answer: bigint;
          startedAt: bigint;
          updatedAt: bigint;
          answeredInRound: bigint;
        }>,
      ]);

      const updatedAt = Number(round.updatedAt);
      const nowSeconds = Math.floor(Date.now() / 1000);

      if (chainlinkConfig.staleAfterSeconds !== undefined) {
        const staleAfterSeconds = Number(chainlinkConfig.staleAfterSeconds);
        if (!Number.isFinite(staleAfterSeconds) || staleAfterSeconds <= 0) {
          throw new Error('staleAfterSeconds must be a positive number when provided');
        }

        if (updatedAt === 0) {
          throw new Error('Chainlink round not complete (updatedAt=0)');
        }

        if (nowSeconds - updatedAt > staleAfterSeconds) {
          throw new Error(
            `Stale Chainlink price (updatedAt=${updatedAt}, now=${nowSeconds}, staleAfterSeconds=${staleAfterSeconds})`
          );
        }
      }

      const rawPrice = formatUnits(round.answer, decimals);
      const formattedPrice = Number.parseFloat(rawPrice).toFixed(2);

      const output: ChainlinkPriceOutput = {
        provider: OracleProvider.CHAINLINK,
        chain: chainlinkConfig.chain,
        aggregatorAddress: chainlinkConfig.aggregatorAddress,
        description,
        // Explicitly convert decimals to number (ethers returns bigint)
        decimals: Number(decimals),
        roundId: round.roundId.toString(),
        answeredInRound: round.answeredInRound.toString(),
        startedAt: Number(round.startedAt),
        updatedAt,
        answer: round.answer.toString(),
        formattedAnswer: formattedPrice,
      };

      const endTime = new Date();

      let finalOutput: any = output;
      if (chainlinkConfig.outputMapping) {
        finalOutput = this.applyOutputMapping(output, chainlinkConfig.outputMapping);
      }

      // Log the price clearly
      logger.info(
        {
          nodeId: input.nodeId,
          chain: chainlinkConfig.chain,
          aggregatorAddress: chainlinkConfig.aggregatorAddress,
          description: output.description,
          price: output.formattedAnswer,
          decimals: output.decimals,
          updatedAt: new Date(updatedAt * 1000).toISOString(),
        },
        ` Chainlink Price Oracle: ${output.description || 'Price Feed'} = $${output.formattedAnswer}`
      );

      return {
        nodeId: input.nodeId,
        success: true,
        output: finalOutput,
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    } catch (error) {
      const endTime = new Date();
      logger.error({ error, nodeId: input.nodeId }, 'Price oracle node execution failed');

      return {
        nodeId: input.nodeId,
        success: false,
        output: null,
        error: {
          message: (error as Error).message,
          code: 'CHAINLINK_PRICE_ORACLE_NODE_ERROR',
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
      return { valid: false, errors: ['Config is required'] };
    }

    const oracleConfig = config as OracleNodeConfig;

    if (!oracleConfig.provider || oracleConfig.provider !== OracleProvider.CHAINLINK) {
      errors.push('Invalid or missing provider (expected CHAINLINK)');
    }

    if (!oracleConfig.chain || !Object.values(SupportedChain).includes(oracleConfig.chain)) {
      errors.push('Invalid or missing chain');
    }

    // Type guard for Chainlink-specific validation
    if (oracleConfig.provider === OracleProvider.CHAINLINK) {
      const chainlinkConfig = oracleConfig as ChainlinkOracleConfig;

      if (!chainlinkConfig.aggregatorAddress || typeof chainlinkConfig.aggregatorAddress !== 'string') {
        errors.push('aggregatorAddress is required');
      } else if (!isAddress(chainlinkConfig.aggregatorAddress)) {
        errors.push('aggregatorAddress must be a valid EVM address');
      }
    }

    return { valid: errors.length === 0, errors: errors.length ? errors : undefined };
  }

  private applyOutputMapping(output: any, mapping: Record<string, string>): any {
    const mapped: any = {};
    for (const [key, path] of Object.entries(mapping)) {
      mapped[key] = this.getValueByPath(output, path);
    }
    return { ...output, ...mapped };
  }

  private getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}


