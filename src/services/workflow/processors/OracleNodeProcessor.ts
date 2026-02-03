import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
  OracleNodeConfig,
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
 * Oracle Node Processor
 * Fetches data from Chainlink Data Feeds (AggregatorV3Interface)
 */
export class OracleNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.PRICE_ORACLE;
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

      // Chainlink read-only calls via shared provider
      const provider = getProvider(config.chain);
      const feed = new Contract(config.aggregatorAddress, AGGREGATOR_V3_ABI, provider);

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

      if (config.staleAfterSeconds !== undefined) {
        const staleAfterSeconds = Number(config.staleAfterSeconds);
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

      const output: ChainlinkPriceOutput = {
        provider: OracleProvider.CHAINLINK,
        chain: config.chain,
        aggregatorAddress: config.aggregatorAddress,
        description,
        decimals,
        roundId: round.roundId.toString(),
        answeredInRound: round.answeredInRound.toString(),
        startedAt: Number(round.startedAt),
        updatedAt,
        answer: round.answer.toString(),
        formattedAnswer: formatUnits(round.answer, decimals),
      };

      const endTime = new Date();

      let finalOutput: any = output;
      if (config.outputMapping) {
        finalOutput = this.applyOutputMapping(output, config.outputMapping);
      }

      logger.info(
        {
          nodeId: input.nodeId,
          chain: config.chain,
          aggregatorAddress: config.aggregatorAddress,
          updatedAt,
        },
        'Price oracle node executed successfully'
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
          code: 'PRICE_ORACLE_NODE_ERROR',
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

    if (!oracleConfig.aggregatorAddress || typeof oracleConfig.aggregatorAddress !== 'string') {
      errors.push('aggregatorAddress is required');
    } else if (!isAddress(oracleConfig.aggregatorAddress)) {
      errors.push('aggregatorAddress must be a valid EVM address');
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


