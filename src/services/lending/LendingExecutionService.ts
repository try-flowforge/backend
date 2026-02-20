import { Wallet } from 'ethers';
import {
  LendingProvider,
  SupportedChain,
  LendingInputConfig,
  LendingQuote,
  LendingExecutionResult,
  ExecutionStatus,
  DBLendingExecution,
} from '../../types/lending.types';
import { lendingProviderFactory } from './providers/LendingProviderFactory';
import { getProvider, waitForTransaction } from '../../config/providers';
import { SECURITY_CONFIG, VALIDATION_CONFIG } from '../../config/chains';
import { logger } from '../../utils/logger';
import { pool } from '../../config/database';
import { parseAmount } from '../../utils/amount';
import { redisClient } from '../../config/redis';

/**
 * Lending Execution Service
 * Handles the complete lifecycle of lending executions with validation, security, and error handling
 */
export class LendingExecutionService {
  /**
   * Validate lending configuration
   */
  async validateLendingConfig(
    chain: SupportedChain,
    provider: LendingProvider,
    config: LendingInputConfig
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Get provider
    const lendingProvider = lendingProviderFactory.getProvider(provider);

    // Provider-specific validation
    const providerValidation = await lendingProvider.validateConfig(chain, config);
    if (!providerValidation.valid && providerValidation.errors) {
      errors.push(...providerValidation.errors);
    }

    // Amount validation
    let parsedAmount: bigint;
    try {
      parsedAmount = parseAmount(config.amount, config.asset.decimals);
      config.amount = parsedAmount.toString();
    } catch (e) {
      errors.push(`Invalid amount format: ${config.amount}`);
      return { valid: false, errors };
    }

    if (parsedAmount < BigInt(VALIDATION_CONFIG.minSwapAmount)) {
      errors.push(`Amount below minimum: ${VALIDATION_CONFIG.minSwapAmount}`);
    }

    // Rate limiting check
    const rateLimitOk = await this.checkRateLimit(config.walletAddress);
    if (!rateLimitOk) {
      errors.push('Rate limit exceeded for wallet');
    }

    // Anti-spam: Check minimum time between operations
    const spamCheckOk = await this.checkSpamProtection(config.walletAddress);
    if (!spamCheckOk) {
      errors.push(
        `Minimum time between operations not met: ${SECURITY_CONFIG.minSwapIntervalMs}ms`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get quote from provider
   */
  async getQuote(
    chain: SupportedChain,
    provider: LendingProvider,
    config: LendingInputConfig
  ): Promise<LendingQuote> {
    logger.info({ chain, provider, operation: config.operation }, 'Getting lending quote');

    // Validate first
    const validation = await this.validateLendingConfig(chain, provider, config);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    const lendingProvider = lendingProviderFactory.getProvider(provider);
    return await lendingProvider.getQuote(chain, config);
  }

  /**
   * Execute a lending operation
   */
  async executeLending(
    nodeExecutionId: string,
    chain: SupportedChain,
    provider: LendingProvider,
    config: LendingInputConfig,
    privateKey: string // Decrypted private key for backend-managed wallet
  ): Promise<LendingExecutionResult> {
    logger.info(
      {
        nodeExecutionId,
        chain,
        provider,
        operation: config.operation,
        walletAddress: config.walletAddress,
      },
      'Starting lending execution'
    );

    const startTime = Date.now();
    let lendingExecutionId: string | null = null;

    try {
      // Validate configuration
      const validation = await this.validateLendingConfig(chain, provider, config);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Create lending execution record
      lendingExecutionId = await this.createLendingExecutionRecord(
        nodeExecutionId,
        chain,
        provider,
        config
      );

      // Get provider
      const lendingProvider = lendingProviderFactory.getProvider(provider);

      // Get quote
      logger.debug('Getting quote...');
      const quote = await lendingProvider.getQuote(chain, config);

      // Build transaction
      logger.debug('Building transaction...');
      const transaction = await lendingProvider.buildTransaction(chain, config, quote);

      // Simulate transaction if enabled (default: true)
      if (config.simulateFirst !== false) {
        logger.debug('Simulating transaction...');
        const simulation = await lendingProvider.simulateTransaction(chain, transaction);

        if (!simulation.success) {
          throw new Error(`Simulation failed: ${simulation.error}`);
        }

        // Update gas estimate from simulation
        if (simulation.gasEstimate) {
          transaction.gasLimit = (
            BigInt(simulation.gasEstimate) * BigInt(120) / BigInt(100)
          ).toString(); // Add 20% buffer
        }
      }

      // Sign and send transaction
      logger.info('Signing and sending transaction...');
      const rpcProvider = getProvider(chain);
      const wallet = new Wallet(privateKey, rpcProvider);

      const txResponse = await wallet.sendTransaction({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
        gasLimit: transaction.gasLimit,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      });

      logger.info({ txHash: txResponse.hash }, 'Transaction sent, waiting for confirmation...');

      // Wait for transaction confirmation
      const receipt = await waitForTransaction(chain, txResponse.hash);

      // Check if receipt exists
      if (!receipt) {
        throw new Error('Transaction receipt not found');
      }

      if (receipt.status === 0) {
        throw new Error('Transaction reverted');
      }

      logger.info(
        {
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
        },
        'Lending operation executed successfully'
      );

      // Get post-execution position
      const newPosition = await lendingProvider.getPosition(
        chain,
        config.walletAddress,
        config.asset.address
      );

      // Update execution record
      await this.updateLendingExecutionRecord(lendingExecutionId, {
        status: ExecutionStatus.SUCCESS,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice?.toString(),
        blockNumber: receipt.blockNumber,
        positionData: Array.isArray(newPosition) ? newPosition[0] : newPosition,
      });

      // Update spam protection
      await this.updateLastOperationTime(config.walletAddress);

      const executionTime = Date.now() - startTime;
      logger.info({ executionTime }, 'Lending execution completed');

      return {
        success: true,
        txHash: receipt.hash,
        operation: config.operation,
        asset: config.asset,
        amount: config.amount,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice?.toString(),
        blockNumber: receipt.blockNumber,
        timestamp: new Date(),
        status: ExecutionStatus.SUCCESS,
        newPosition: Array.isArray(newPosition) ? newPosition[0] : newPosition,
      };
    } catch (error: any) {
      logger.error(
        {
          error,
          nodeExecutionId,
          chain,
          provider,
          operation: config.operation,
        },
        'Lending execution failed'
      );

      // Update execution record with error
      if (lendingExecutionId) {
        await this.updateLendingExecutionRecord(lendingExecutionId, {
          status: ExecutionStatus.FAILED,
          errorMessage: error.message,
          errorCode: error.code || 'EXECUTION_ERROR',
        });
      }

      return {
        success: false,
        operation: config.operation,
        asset: config.asset,
        amount: config.amount,
        timestamp: new Date(),
        status: ExecutionStatus.FAILED,
        errorMessage: error.message,
        errorCode: error.code || 'EXECUTION_ERROR',
      };
    }
  }

  /**
   * Create lending execution record in database
   */
  private async createLendingExecutionRecord(
    nodeExecutionId: string,
    chain: SupportedChain,
    provider: LendingProvider,
    config: LendingInputConfig
  ): Promise<string> {
    const query = `
      INSERT INTO lending_executions (
        node_execution_id,
        provider,
        chain,
        wallet_address,
        operation,
        asset,
        amount,
        interest_rate_mode,
        status,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING id
    `;

    const values = [
      nodeExecutionId,
      provider,
      chain,
      config.walletAddress,
      config.operation,
      JSON.stringify(config.asset),
      config.amount,
      config.interestRateMode || null,
      ExecutionStatus.PENDING,
    ];

    const result = await pool.query(query, values);
    return result.rows[0].id;
  }

  /**
   * Update lending execution record
   */
  private async updateLendingExecutionRecord(
    executionId: string,
    updates: {
      status?: ExecutionStatus;
      txHash?: string;
      gasUsed?: string;
      effectiveGasPrice?: string;
      blockNumber?: number;
      errorMessage?: string;
      errorCode?: string;
      positionData?: any;
    }
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.status) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }

    if (updates.txHash) {
      setClauses.push(`tx_hash = $${paramIndex++}`);
      values.push(updates.txHash);
    }

    if (updates.gasUsed) {
      setClauses.push(`gas_used = $${paramIndex++}`);
      values.push(updates.gasUsed);
    }

    if (updates.effectiveGasPrice) {
      setClauses.push(`effective_gas_price = $${paramIndex++}`);
      values.push(updates.effectiveGasPrice);
    }

    if (updates.blockNumber) {
      setClauses.push(`block_number = $${paramIndex++}`);
      values.push(updates.blockNumber);
    }

    if (updates.errorMessage) {
      setClauses.push(`error_message = $${paramIndex++}`);
      values.push(updates.errorMessage);
    }

    if (updates.errorCode) {
      setClauses.push(`error_code = $${paramIndex++}`);
      values.push(updates.errorCode);
    }

    if (updates.positionData) {
      setClauses.push(`position_data = $${paramIndex++}`);
      values.push(JSON.stringify(updates.positionData));
    }

    if (updates.status === ExecutionStatus.SUCCESS || updates.status === ExecutionStatus.FAILED) {
      setClauses.push(`completed_at = NOW()`);
    }

    values.push(executionId);

    const query = `
      UPDATE lending_executions
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `;

    await pool.query(query, values);
  }

  /**
   * Check rate limit for wallet
   */
  private async checkRateLimit(walletAddress: string): Promise<boolean> {
    const key = `lending:ratelimit:${walletAddress}`;
    const limit = SECURITY_CONFIG.rateLimits.swapPerHour; // Reuse swap rate limit config
    const window = 3600; // 1 hour in seconds

    try {
      const current = await redisClient.incr(key);

      if (current === 1) {
        await redisClient.expire(key, window);
      }

      return current <= limit;
    } catch (error) {
      logger.error({ error }, 'Rate limit check failed');
      return true; // Fail open
    }
  }

  /**
   * Check spam protection (minimum time between operations)
   */
  private async checkSpamProtection(walletAddress: string): Promise<boolean> {
    const key = `lending:lastop:${walletAddress}`;

    try {
      const lastOpTime = await redisClient.get(key);

      if (!lastOpTime) {
        return true;
      }

      const timeSinceLastOp = Date.now() - parseInt(lastOpTime);
      return timeSinceLastOp >= SECURITY_CONFIG.minSwapIntervalMs;
    } catch (error) {
      logger.error({ error }, 'Spam protection check failed');
      return true; // Fail open
    }
  }

  /**
   * Update last operation time for spam protection
   */
  private async updateLastOperationTime(walletAddress: string): Promise<void> {
    const key = `lending:lastop:${walletAddress}`;

    try {
      await redisClient.set(key, Date.now().toString(), {
        EX: 3600, // Expire after 1 hour
      });
    } catch (error) {
      logger.error({ error }, 'Failed to update last operation time');
    }
  }

  /**
   * Get lending execution by ID
   */
  async getLendingExecution(executionId: string): Promise<DBLendingExecution | null> {
    const query = `
      SELECT * FROM lending_executions
      WHERE id = $1
    `;

    const result = await pool.query(query, [executionId]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0] as DBLendingExecution;
  }

  /**
   * Get lending executions for a node execution
   */
  async getLendingExecutionsByNodeExecution(
    nodeExecutionId: string
  ): Promise<DBLendingExecution[]> {
    const query = `
      SELECT * FROM lending_executions
      WHERE node_execution_id = $1
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [nodeExecutionId]);
    return result.rows as DBLendingExecution[];
  }

  /**
   * Get lending executions for a wallet
   */
  async getLendingExecutionsByWallet(
    walletAddress: string,
    limit: number = 50
  ): Promise<DBLendingExecution[]> {
    const query = `
      SELECT * FROM lending_executions
      WHERE wallet_address = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [walletAddress, limit]);
    return result.rows as DBLendingExecution[];
  }
}

// Export singleton instance
export const lendingExecutionService = new LendingExecutionService();

