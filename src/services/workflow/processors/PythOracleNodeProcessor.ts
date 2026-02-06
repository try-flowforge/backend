import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
  PythOracleConfig,
  OracleProvider,
  SupportedChain,
  PythPriceOutput,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { logger } from '../../../utils/logger';
import { getProvider } from '../../../config/providers';
import { Contract, formatUnits } from 'ethers';

// Pyth Contract ABI for reading price feeds
const PYTH_ABI = [
  'function getPriceUnsafe(bytes32 id) view returns (int64 price, uint64 conf, int32 expo, uint256 publishTime)',
  'function getPrice(bytes32 id) view returns (int64 price, uint64 conf, int32 expo, uint256 publishTime)',
];

// Pyth Contract Addresses per chain
// Note: Only chains currently supported by the system are included
// Add more chains as they become available in SupportedChain enum
const PYTH_CONTRACT_ADDRESSES: Partial<Record<SupportedChain, string>> = {
  [SupportedChain.ARBITRUM]: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
  [SupportedChain.ARBITRUM_SEPOLIA]: '0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF',
  [SupportedChain.ETHEREUM_SEPOLIA]: '0x4305FB66699C3B2702D4d05CF36551390A4c69C6',
  // Pyth is also available on other chains (add when chains are supported):
  // ETHEREUM: '0x4305FB66699C3B2702D4d05CF36551390A4c69C6',
  // BASE: '0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a',
  // OPTIMISM: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
  // POLYGON: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
};

/**
 * Pyth Network Price Oracle Node Processor
 * Fetches data from Pyth Network price feeds
 * 
 * See: https://docs.pyth.network/price-feeds
 */
export class PythOracleNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.PYTH_PRICE_ORACLE;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, 'Executing Pyth price oracle node');

    try {
      const config: PythOracleConfig = input.nodeConfig;

      const validation = await this.validate(config);
      if (!validation.valid) {
        throw new Error(`Invalid Pyth oracle configuration: ${validation.errors?.join(', ')}`);
      }

      // Get Pyth contract address for the chain
      const pythContractAddress = PYTH_CONTRACT_ADDRESSES[config.chain];
      if (!pythContractAddress) {
        throw new Error(`Pyth contract not deployed on chain: ${config.chain}`);
      }

      // Get provider and create contract instance
      const provider = getProvider(config.chain);
      const pythContract = new Contract(pythContractAddress, PYTH_ABI, provider);

      // Fetch price data from Pyth
      const priceData = await pythContract.getPriceUnsafe(config.priceFeedId) as {
        price: bigint;
        conf: bigint;
        expo: bigint;
        publishTime: bigint;
      };

      const publishTime = Number(priceData.publishTime);
      const nowSeconds = Math.floor(Date.now() / 1000);

      // Check staleness if configured
      if (config.staleAfterSeconds !== undefined) {
        const staleAfterSeconds = Number(config.staleAfterSeconds);
        if (!Number.isFinite(staleAfterSeconds) || staleAfterSeconds <= 0) {
          throw new Error('staleAfterSeconds must be a positive number when provided');
        }

        if (publishTime === 0) {
          throw new Error('Pyth price not published yet (publishTime=0)');
        }

        if (nowSeconds - publishTime > staleAfterSeconds) {
          throw new Error(
            `Stale Pyth price (publishTime=${publishTime}, now=${nowSeconds}, staleAfterSeconds=${staleAfterSeconds})`
          );
        }
      }

      // Format the price using the exponent
      const exponent = Number(priceData.expo);
      const decimals = Math.abs(exponent);
      const formattedPrice = formatUnits(priceData.price, decimals);

      const output: PythPriceOutput = {
        provider: OracleProvider.PYTH,
        chain: config.chain,
        priceFeedId: config.priceFeedId,
        price: priceData.price.toString(),
        confidence: priceData.conf.toString(),
        exponent,
        publishTime,
        formattedPrice,
      };

      const endTime = new Date();

      let finalOutput: any = output;
      if (config.outputMapping) {
        finalOutput = this.applyOutputMapping(output, config.outputMapping);
      }

      // Log the price clearly
      logger.info(
        {
          nodeId: input.nodeId,
          chain: config.chain,
          priceFeedId: config.priceFeedId,
          price: output.formattedPrice,
          confidence: formatUnits(priceData.conf, Math.abs(exponent)),
          publishTime: new Date(publishTime * 1000).toISOString(),
        },
        ` Pyth Price Oracle: Price = $${output.formattedPrice} (±$${formatUnits(priceData.conf, Math.abs(exponent))})`
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
      logger.error({ error, nodeId: input.nodeId }, 'Pyth price oracle node execution failed');

      return {
        nodeId: input.nodeId,
        success: false,
        output: null,
        error: {
          message: (error as Error).message,
          code: 'PYTH_PRICE_ORACLE_NODE_ERROR',
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

    const pythConfig = config as PythOracleConfig;

    if (!pythConfig.provider || pythConfig.provider !== OracleProvider.PYTH) {
      errors.push('Invalid or missing provider (expected PYTH)');
    }

    if (!pythConfig.chain || !Object.values(SupportedChain).includes(pythConfig.chain)) {
      errors.push('Invalid or missing chain');
    }

    if (!pythConfig.priceFeedId || typeof pythConfig.priceFeedId !== 'string') {
      errors.push('priceFeedId is required and must be a string');
    } else if (!pythConfig.priceFeedId.startsWith('0x') || pythConfig.priceFeedId.length !== 66) {
      errors.push('priceFeedId must be a 66-character hex string (32 bytes) starting with 0x');
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

