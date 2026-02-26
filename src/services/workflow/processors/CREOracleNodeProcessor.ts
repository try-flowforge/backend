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
import { creClient, mapSupportedChainToChainName } from '../../cre/CREClient';

type OracleWorkflowInput = {
  chainName: string;
  feeds: Array<{
    name: string;
    address: string;
  }>;
  staleAfterSeconds?: number;
};

export class CREOracleNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.CHAINLINK_PRICE_ORACLE;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, 'Executing CRE oracle node');

    try {
      const config = input.nodeConfig as OracleNodeConfig;

      if (config.provider !== OracleProvider.CHAINLINK) {
        throw new Error(
          `CREOracleNodeProcessor only supports CHAINLINK provider, got ${config.provider}`,
        );
      }

      const chainlinkConfig = config as ChainlinkOracleConfig;

      const chainName = mapSupportedChainToChainName(chainlinkConfig.chain);

      const workflowInput: OracleWorkflowInput = {
        chainName,
        feeds: [
          {
            name: 'price',
            address: chainlinkConfig.aggregatorAddress,
          },
        ],
        staleAfterSeconds: chainlinkConfig.staleAfterSeconds,
      };

      if (!creClient.isConfigured()) {
        throw new Error('CREClient is not configured; cannot call CRE oracle workflow');
      }

      const results = await creClient.invokeOracle<
        OracleWorkflowInput,
        ChainlinkPriceOutput[]
      >(workflowInput);

      if (!Array.isArray(results) || results.length === 0) {
        throw new Error('CRE oracle workflow returned no results');
      }

      const primary = results[0];

      const normalized: ChainlinkPriceOutput = {
        provider: OracleProvider.CHAINLINK,
        chain: chainlinkConfig.chain,
        aggregatorAddress: chainlinkConfig.aggregatorAddress,
        description: primary.description,
        decimals: primary.decimals,
        roundId: primary.roundId,
        answeredInRound: primary.answeredInRound,
        startedAt: primary.startedAt,
        updatedAt: primary.updatedAt,
        answer: primary.answer,
        formattedAnswer: primary.formattedAnswer,
      };

      let finalOutput: any = normalized;
      if (chainlinkConfig.outputMapping) {
        finalOutput = this.applyOutputMapping(
          normalized,
          chainlinkConfig.outputMapping,
        );
      }

      const endTime = new Date();

      logger.info(
        {
          nodeId: input.nodeId,
          chain: chainlinkConfig.chain,
          aggregatorAddress: chainlinkConfig.aggregatorAddress,
          description: normalized.description,
          price: normalized.formattedAnswer,
          decimals: normalized.decimals,
          updatedAt: new Date(normalized.updatedAt * 1000).toISOString(),
        },
        'CRE Chainlink Price Oracle result',
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
      logger.error(
        { error, nodeId: input.nodeId },
        'CRE oracle node execution failed',
      );

      return {
        nodeId: input.nodeId,
        success: false,
        output: null,
        error: {
          message: (error as Error).message,
          code: 'CRE_CHAINLINK_PRICE_ORACLE_NODE_ERROR',
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

    if (
      !oracleConfig.provider ||
      oracleConfig.provider !== OracleProvider.CHAINLINK
    ) {
      errors.push('Invalid or missing provider (expected CHAINLINK)');
    }

    if (
      !oracleConfig.chain ||
      !Object.values(SupportedChain).includes(oracleConfig.chain)
    ) {
      errors.push('Invalid or missing chain');
    }

    const chainlinkConfig = oracleConfig as ChainlinkOracleConfig;

    if (
      !chainlinkConfig.aggregatorAddress ||
      typeof chainlinkConfig.aggregatorAddress !== 'string'
    ) {
      errors.push('aggregatorAddress is required');
    }

    return { valid: errors.length === 0, errors: errors.length ? errors : undefined };
  }

  private applyOutputMapping(
    output: any,
    mapping: Record<string, string>,
  ): any {
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

