import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
  PerpsAction,
  PerpsNodeConfig,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { ostiumServiceClient } from '../../ostium/ostium-service-client';
import { perpsExecutionService } from '../../ostium/perps-execution.service';
import { ostiumSetupService } from '../../ostium/ostium-setup.service';
import { logger } from '../../../utils/logger';
import { pool } from '../../../config/database';
import { UserModel } from '../../../models/users';
import { NUMERIC_CHAIN_IDS } from '../../../config/chain-registry';

export class PerpsNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.PERPS;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, 'Executing perps node');

    let perpsExecutionId: string | null = null;

    try {
      const config: PerpsNodeConfig = input.nodeConfig;

      const validation = await this.validate(config);
      if (!validation.valid) {
        throw new Error(`Invalid perps configuration: ${validation.errors?.join(', ')}`);
      }

      const nodeExecutionId = await this.getNodeExecutionId(
        input.executionContext.executionId,
        input.nodeId,
      );

      perpsExecutionId = await perpsExecutionService.create({
        nodeExecutionId,
        workflowExecutionId: input.executionContext.executionId,
        userId: input.executionContext.userId,
        network: config.network,
        action: config.action,
        requestPayload: config,
      });

      let result: any;
      switch (config.action) {
        case 'MARKETS':
          result = await ostiumServiceClient.listMarkets({ network: config.network }, nodeExecutionId);
          break;
        case 'PRICE': {
          const base = config.base || config.market;
          if (!base) {
            throw new Error('base or market is required for PRICE action');
          }
          result = await ostiumServiceClient.getPrice(
            {
              network: config.network,
              base,
              quote: config.quote || 'USD',
            },
            nodeExecutionId,
          );
          break;
        }
        case 'BALANCE':
          result = await ostiumServiceClient.getBalance(
            {
              network: config.network,
              address: await this.resolveSafeAddress(
                config.address,
                input.executionContext.userId,
                config.network,
              ),
            },
            nodeExecutionId,
          );
          break;
        case 'LIST_POSITIONS':
          result = await ostiumServiceClient.listPositions(
            {
              network: config.network,
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
            },
            nodeExecutionId,
          );
          break;
        case 'OPEN_POSITION': {
          await this.ensureWriteReadiness(input.executionContext.userId, config.network, config.action);
          result = await ostiumServiceClient.openPosition(
            {
              network: config.network,
              market: this.required(config.market, 'market is required for OPEN_POSITION'),
              side: this.required(config.side, 'side is required for OPEN_POSITION'),
              collateral: this.required(config.collateral, 'collateral is required for OPEN_POSITION'),
              leverage: this.required(config.leverage, 'leverage is required for OPEN_POSITION'),
              orderType: config.orderType,
              triggerPrice: config.triggerPrice,
              slippage: config.slippage,
              slPrice: config.slPrice,
              tpPrice: config.tpPrice,
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
              idempotencyKey: config.idempotencyKey,
            },
            nodeExecutionId,
          );
          break;
        }
        case 'CLOSE_POSITION': {
          await this.ensureWriteReadiness(input.executionContext.userId, config.network, config.action);
          result = await ostiumServiceClient.closePosition(
            {
              network: config.network,
              pairId: this.required(config.pairId, 'pairId is required for CLOSE_POSITION'),
              tradeIndex: this.required(config.tradeIndex, 'tradeIndex is required for CLOSE_POSITION'),
              closePercentage: config.closePercentage,
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
              idempotencyKey: config.idempotencyKey,
            },
            nodeExecutionId,
          );
          break;
        }
        case 'UPDATE_SL': {
          await this.ensureWriteReadiness(input.executionContext.userId, config.network, config.action);
          result = await ostiumServiceClient.updateStopLoss(
            {
              network: config.network,
              pairId: this.required(config.pairId, 'pairId is required for UPDATE_SL'),
              tradeIndex: this.required(config.tradeIndex, 'tradeIndex is required for UPDATE_SL'),
              slPrice: this.required(config.slPrice, 'slPrice is required for UPDATE_SL'),
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
            },
            nodeExecutionId,
          );
          break;
        }
        case 'UPDATE_TP': {
          await this.ensureWriteReadiness(input.executionContext.userId, config.network, config.action);
          result = await ostiumServiceClient.updateTakeProfit(
            {
              network: config.network,
              pairId: this.required(config.pairId, 'pairId is required for UPDATE_TP'),
              tradeIndex: this.required(config.tradeIndex, 'tradeIndex is required for UPDATE_TP'),
              tpPrice: this.required(config.tpPrice, 'tpPrice is required for UPDATE_TP'),
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
            },
            nodeExecutionId,
          );
          break;
        }
        case 'LIST_ORDERS':
          result = await ostiumServiceClient.listOrders(
            {
              network: config.network,
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
            },
            nodeExecutionId,
          );
          break;
        case 'CANCEL_ORDER':
          result = await ostiumServiceClient.cancelOrder(
            {
              network: config.network,
              orderId: this.required(config.orderId, 'orderId is required for CANCEL_ORDER'),
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
            },
            nodeExecutionId,
          );
          break;
        case 'UPDATE_ORDER':
          result = await ostiumServiceClient.updateOrder(
            {
              network: config.network,
              orderId: this.required(config.orderId, 'orderId is required for UPDATE_ORDER'),
              triggerPrice: config.triggerPrice,
              slPrice: config.slPrice,
              tpPrice: config.tpPrice,
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
            },
            nodeExecutionId,
          );
          break;
        case 'TRACK_ORDER':
          result = await ostiumServiceClient.trackOrder(
            {
              network: config.network,
              orderId: this.required(config.orderId, 'orderId is required for TRACK_ORDER'),
            },
            nodeExecutionId,
          );
          break;
        case 'POSITION_METRICS':
          result = await ostiumServiceClient.getPositionMetrics(
            {
              network: config.network,
              pairId: this.required(config.pairId, 'pairId is required for POSITION_METRICS'),
              tradeIndex: this.required(config.tradeIndex, 'tradeIndex is required for POSITION_METRICS'),
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
            },
            nodeExecutionId,
          );
          break;
        case 'HISTORY':
          result = await ostiumServiceClient.getHistory(
            {
              network: config.network,
              limit: config.limit,
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
            },
            nodeExecutionId,
          );
          break;
        case 'FAUCET':
          result = await ostiumServiceClient.requestFaucet(
            {
              network: config.network,
              traderAddress: await this.resolveSafeAddress(
                config.traderAddress,
                input.executionContext.userId,
                config.network,
              ),
            },
            nodeExecutionId,
          );
          break;
        case 'MARKET_DETAILS':
          result = await ostiumServiceClient.getMarketDetails(
            {
              network: config.network,
              pairId: this.required(config.pairId, 'pairId is required for MARKET_DETAILS'),
            },
            nodeExecutionId,
          );
          break;
        case 'MARKET_FUNDING':
          result = await ostiumServiceClient.getMarketFunding(
            {
              network: config.network,
              pairId: this.required(config.pairId, 'pairId is required for MARKET_FUNDING'),
              periodHours: config.periodHours,
            },
            nodeExecutionId,
          );
          break;
        case 'MARKET_ROLLOVER':
          result = await ostiumServiceClient.getMarketRollover(
            {
              network: config.network,
              pairId: this.required(config.pairId, 'pairId is required for MARKET_ROLLOVER'),
              periodHours: config.periodHours,
            },
            nodeExecutionId,
          );
          break;
        default:
          throw new Error(`Unsupported perps action: ${config.action}`);
      }

      if (perpsExecutionId) {
        await perpsExecutionService.complete(perpsExecutionId, {
          success: true,
          responsePayload: result,
          txHash: result?.txHash || result?.transactionHash || null,
        });
      }

      const output = config.outputMapping ? this.applyOutputMapping(result, config.outputMapping) : result;
      const endTime = new Date();

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
      logger.error({ error, nodeId: input.nodeId }, 'Perps node execution failed');

      if (perpsExecutionId) {
        await perpsExecutionService.complete(perpsExecutionId, {
          success: false,
          errorCode: 'PERPS_NODE_ERROR',
          errorMessage: (error as Error).message,
        });
      }

      return {
        nodeId: input.nodeId,
        success: false,
        output: null,
        error: {
          message: (error as Error).message,
          code: 'PERPS_NODE_ERROR',
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

    const perpsConfig = config as PerpsNodeConfig;

    if (perpsConfig.provider !== 'OSTIUM') {
      errors.push('provider must be OSTIUM');
    }

    if (!perpsConfig.network || !['testnet', 'mainnet'].includes(perpsConfig.network)) {
      errors.push('network must be testnet or mainnet');
    }

    if (!perpsConfig.action) {
      errors.push('action is required');
    }

    switch (perpsConfig.action) {
      case 'PRICE':
        if (!perpsConfig.base && !perpsConfig.market) {
          errors.push('base or market is required for PRICE');
        }
        break;
      case 'OPEN_POSITION':
        if (!perpsConfig.market) errors.push('market is required for OPEN_POSITION');
        if (!perpsConfig.side || !['long', 'short'].includes(perpsConfig.side)) {
          errors.push('side must be long or short for OPEN_POSITION');
        }
        if (perpsConfig.collateral == null || perpsConfig.collateral <= 0) {
          errors.push('collateral must be > 0 for OPEN_POSITION');
        }
        if (perpsConfig.leverage == null || perpsConfig.leverage <= 0) {
          errors.push('leverage must be > 0 for OPEN_POSITION');
        }
        if (perpsConfig.orderType === 'limit' || perpsConfig.orderType === 'stop') {
          if (perpsConfig.triggerPrice == null || perpsConfig.triggerPrice <= 0) {
            errors.push('triggerPrice must be > 0 for limit/stop orders');
          }
        }
        break;
      case 'CLOSE_POSITION':
        if (perpsConfig.pairId == null) errors.push('pairId is required for CLOSE_POSITION');
        if (perpsConfig.tradeIndex == null) errors.push('tradeIndex is required for CLOSE_POSITION');
        break;
      case 'UPDATE_SL':
        if (perpsConfig.pairId == null) errors.push('pairId is required for UPDATE_SL');
        if (perpsConfig.tradeIndex == null) errors.push('tradeIndex is required for UPDATE_SL');
        if (perpsConfig.slPrice == null || perpsConfig.slPrice <= 0) {
          errors.push('slPrice must be > 0 for UPDATE_SL');
        }
        break;
      case 'UPDATE_TP':
        if (perpsConfig.pairId == null) errors.push('pairId is required for UPDATE_TP');
        if (perpsConfig.tradeIndex == null) errors.push('tradeIndex is required for UPDATE_TP');
        if (perpsConfig.tpPrice == null || perpsConfig.tpPrice <= 0) {
          errors.push('tpPrice must be > 0 for UPDATE_TP');
        }
        break;
      case 'CANCEL_ORDER':
      case 'UPDATE_ORDER':
      case 'TRACK_ORDER':
        if (!perpsConfig.orderId) errors.push('orderId is required');
        break;
      case 'POSITION_METRICS':
      case 'MARKET_DETAILS':
      case 'MARKET_FUNDING':
      case 'MARKET_ROLLOVER':
        if (perpsConfig.pairId == null) errors.push('pairId is required');
        break;
      default:
        break;
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private async getNodeExecutionId(executionId: string, nodeId: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM node_executions WHERE execution_id = $1 AND node_id = $2 ORDER BY started_at DESC LIMIT 1',
      [executionId, nodeId],
    );

    if (result.rows.length === 0) {
      throw new Error('Node execution not found');
    }

    return result.rows[0].id;
  }

  private async getSafeAddressByNetwork(userId: string, network: 'testnet' | 'mainnet'): Promise<string> {
    const chainId = network === 'testnet' ? NUMERIC_CHAIN_IDS.ARBITRUM_SEPOLIA : NUMERIC_CHAIN_IDS.ARBITRUM;
    const safeAddress = await UserModel.getSafeAddressByChain(userId, chainId);
    if (!safeAddress) {
      throw new Error(
        `Safe wallet not found for user ${userId} on ${network} (${chainId}). Create Safe first via /api/v1/relay/create-safe`,
      );
    }
    return safeAddress;
  }

  private async resolveSafeAddress(
    providedAddress: string | undefined,
    userId: string,
    network: 'testnet' | 'mainnet',
  ): Promise<string> {
    const safeAddress = await this.getSafeAddressByNetwork(userId, network);
    if (providedAddress && providedAddress.trim().length > 0) {
      if (providedAddress.toLowerCase() !== safeAddress.toLowerCase()) {
        throw new Error(`Provided address must match your Safe wallet address for ${network}`);
      }
    }
    return safeAddress;
  }

  private actionRequiresActiveDelegation(action: PerpsAction): boolean {
    return (
      action === 'OPEN_POSITION' ||
      action === 'CLOSE_POSITION' ||
      action === 'UPDATE_SL' ||
      action === 'UPDATE_TP'
    );
  }

  private readinessKeysForAction(action: PerpsAction): Array<'safeWallet' | 'delegation' | 'usdcBalance' | 'allowance' | 'delegateGas'> {
    if (action === 'OPEN_POSITION') {
      return ['safeWallet', 'delegation', 'usdcBalance', 'allowance', 'delegateGas'];
    }
    if (action === 'CLOSE_POSITION' || action === 'UPDATE_SL' || action === 'UPDATE_TP') {
      return ['safeWallet', 'delegation', 'delegateGas'];
    }
    return [];
  }

  private async ensureWriteReadiness(
    userId: string,
    network: 'testnet' | 'mainnet',
    action: PerpsAction,
  ): Promise<void> {
    if (!this.actionRequiresActiveDelegation(action)) {
      return;
    }

    const readiness = await ostiumSetupService.getReadiness(userId, network);
    const failedMessages = this.readinessKeysForAction(action)
      .map((key) => readiness.checks[key])
      .filter((entry) => !entry.ok)
      .map((entry) => entry.message);

    if (failedMessages.length > 0) {
      throw new Error(`Ostium readiness checks failed: ${failedMessages.join(' | ')}`);
    }
  }

  private required<T>(value: T | undefined | null, errorMessage: string): T {
    if (value === undefined || value === null) {
      throw new Error(errorMessage);
    }
    return value;
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
