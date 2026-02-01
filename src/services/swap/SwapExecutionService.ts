import { Wallet } from 'ethers';
import {
  SwapProvider,
  SupportedChain,
  SwapInputConfig,
  SwapQuote,
  SwapTransaction,
  SwapExecutionResult,
  ExecutionStatus,
  DBSwapExecution,
} from '../../types';
import { swapProviderFactory } from './providers/SwapProviderFactory';
import { getProvider, waitForTransaction } from '../../config/providers';
import { SECURITY_CONFIG, VALIDATION_CONFIG } from '../../config/chains';
import { logger } from '../../utils/logger';
import { pool } from '../../config/database';
import { redisClient } from '../../config/redis';

/**
 * Swap Execution Service
 * Handles the complete lifecycle of swap executions with validation, security, and error handling
 */
export class SwapExecutionService {
  /**
   * Validate swap configuration
   */
  async validateSwapConfig(
    chain: SupportedChain,
    provider: SwapProvider,
    config: SwapInputConfig
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Get provider
    const swapProvider = swapProviderFactory.getProvider(provider);

    // Provider-specific validation
    const providerValidation = await swapProvider.validateConfig(chain, config);
    if (!providerValidation.valid && providerValidation.errors) {
      errors.push(...providerValidation.errors);
    }

    // Security validations
    if (config.slippageTolerance && config.slippageTolerance > SECURITY_CONFIG.maxSlippageTolerance) {
      errors.push(
        `Slippage tolerance exceeds maximum: ${SECURITY_CONFIG.maxSlippageTolerance}%`
      );
    }

    // Amount validation
    if (BigInt(config.amount) < BigInt(VALIDATION_CONFIG.minSwapAmount)) {
      errors.push(`Amount below minimum: ${VALIDATION_CONFIG.minSwapAmount}`);
    }

    // Rate limiting check
    const rateLimitOk = await this.checkRateLimit(config.walletAddress);
    if (!rateLimitOk) {
      errors.push('Rate limit exceeded for wallet');
    }

    // Anti-spam: Check minimum time between swaps
    const spamCheckOk = await this.checkSpamProtection(config.walletAddress);
    if (!spamCheckOk) {
      errors.push(
        `Minimum time between swaps not met: ${SECURITY_CONFIG.minSwapIntervalMs}ms`
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
    provider: SwapProvider,
    config: SwapInputConfig
  ): Promise<SwapQuote> {
    logger.info({ chain, provider }, 'Getting swap quote');

    // Validate first
    const validation = await this.validateSwapConfig(chain, provider, config);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    const swapProvider = swapProviderFactory.getProvider(provider);
    return await swapProvider.getQuote(chain, config);
  }

  /**
   * Execute a swap
   */
  async executeSwap(
    nodeExecutionId: string,
    chain: SupportedChain,
    provider: SwapProvider,
    config: SwapInputConfig,
    privateKey: string // Decrypted private key for backend-managed wallet
  ): Promise<SwapExecutionResult> {
    logger.info(
      {
        nodeExecutionId,
        chain,
        provider,
        walletAddress: config.walletAddress,
      },
      'Starting swap execution'
    );

    const startTime = Date.now();
    let swapExecutionId: string | null = null;

    try {
      // Validate configuration
      const validation = await this.validateSwapConfig(chain, provider, config);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Create swap execution record
      swapExecutionId = await this.createSwapExecutionRecord(
        nodeExecutionId,
        chain,
        provider,
        config
      );

      // Get provider
      const swapProvider = swapProviderFactory.getProvider(provider);

      // Get quote
      logger.debug('Getting quote...');
      const quote = await swapProvider.getQuote(chain, config);

      // Build transaction
      logger.debug('Building transaction...');
      const transaction = await swapProvider.buildTransaction(chain, config, quote);

      // Simulate transaction if enabled (default: true)
      if (config.simulateFirst !== false) {
        logger.debug('Simulating transaction...');
        const simulation = await swapProvider.simulateTransaction(chain, transaction);
        
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
      const txHash = await this.signAndSendTransaction(
        chain,
        transaction,
        privateKey
      );

      logger.info({ txHash }, 'Transaction sent');

      // Update swap execution with tx hash
      await this.updateSwapExecution(swapExecutionId, {
        tx_hash: txHash,
        status: ExecutionStatus.RUNNING,
      });

      // Wait for confirmation
      logger.info('Waiting for transaction confirmation...');
      const receipt = await waitForTransaction(chain, txHash, 1);

      if (!receipt) {
        throw new Error('Transaction receipt not found');
      }

      // Calculate execution result
      const result: SwapExecutionResult = {
        success: true,
        txHash: receipt.hash,
        fromToken: config.sourceToken,
        toToken: config.destinationToken,
        amountIn: config.amount,
        amountOut: quote.amountOut,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice?.toString(),
        blockNumber: receipt.blockNumber,
        timestamp: new Date(),
        status: ExecutionStatus.SUCCESS,
      };

      // Update swap execution record
      await this.updateSwapExecution(swapExecutionId, {
        amount_out: quote.amountOut,
        gas_used: result.gasUsed,
        effective_gas_price: result.effectiveGasPrice,
        block_number: result.blockNumber,
        status: ExecutionStatus.SUCCESS,
        completed_at: new Date(),
      });

      // Update rate limiting
      await this.recordSwapExecution(config.walletAddress);

      logger.info(
        {
          txHash: result.txHash,
          duration: Date.now() - startTime,
        },
        'Swap executed successfully'
      );

      return result;
    } catch (error) {
      logger.error({ error, nodeExecutionId }, 'Swap execution failed');

      // Update swap execution record with error
      if (swapExecutionId) {
        await this.updateSwapExecution(swapExecutionId, {
          status: ExecutionStatus.FAILED,
          error_message: (error as Error).message,
          error_code: (error as any).code || 'UNKNOWN_ERROR',
          completed_at: new Date(),
        });
      }

      return {
        success: false,
        fromToken: config.sourceToken,
        toToken: config.destinationToken,
        amountIn: config.amount,
        timestamp: new Date(),
        status: ExecutionStatus.FAILED,
        errorMessage: (error as Error).message,
        errorCode: (error as any).code || 'UNKNOWN_ERROR',
      };
    }
  }

  /**
   * Sign and send transaction
   */
  private async signAndSendTransaction(
    chain: SupportedChain,
    transaction: SwapTransaction,
    privateKey: string
  ): Promise<string> {
    const provider = getProvider(chain);
    const wallet = new Wallet(privateKey, provider);

    // Send transaction
    const tx = await wallet.sendTransaction({
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      gasLimit: transaction.gasLimit,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
      chainId: transaction.chainId,
    });

    return tx.hash;
  }

  /**
   * Create swap execution database record
   */
  private async createSwapExecutionRecord(
    nodeExecutionId: string,
    chain: SupportedChain,
    provider: SwapProvider,
    config: SwapInputConfig
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO swap_executions (
        node_execution_id,
        provider,
        chain,
        wallet_address,
        source_token,
        destination_token,
        amount_in,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        nodeExecutionId,
        provider,
        chain,
        config.walletAddress,
        JSON.stringify(config.sourceToken),
        JSON.stringify(config.destinationToken),
        config.amount,
        ExecutionStatus.PENDING,
      ]
    );

    return result.rows[0].id;
  }

  /**
   * Update swap execution record
   */
  private async updateSwapExecution(
    id: string,
    updates: Partial<DBSwapExecution>
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      fields.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    });

    if (fields.length === 0) return;

    values.push(id);
    await pool.query(
      `UPDATE swap_executions SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  /**
   * Check rate limiting
   */
  private async checkRateLimit(walletAddress: string): Promise<boolean> {
    const key = `ratelimit:swap:${walletAddress}`;
    const count = await redisClient.get(key);

    if (!count) return true;

    return parseInt(count) < SECURITY_CONFIG.rateLimits.swapPerHour;
  }

  /**
   * Check spam protection
   */
  private async checkSpamProtection(walletAddress: string): Promise<boolean> {
    const key = `spam:swap:${walletAddress}`;
    const lastSwap = await redisClient.get(key);

    if (!lastSwap) return true;

    const lastSwapTime = parseInt(lastSwap);
    const now = Date.now();

    return now - lastSwapTime >= SECURITY_CONFIG.minSwapIntervalMs;
  }

  /**
   * Record swap execution for rate limiting
   */
  private async recordSwapExecution(walletAddress: string): Promise<void> {
    // Increment hourly counter
    const rateLimitKey = `ratelimit:swap:${walletAddress}`;
    await redisClient.incr(rateLimitKey);
    await redisClient.expire(rateLimitKey, 3600); // 1 hour

    // Update last swap timestamp
    const spamKey = `spam:swap:${walletAddress}`;
    await redisClient.set(spamKey, Date.now().toString());
    await redisClient.expire(spamKey, 60); // 1 minute
  }

  /**
   * Get swap execution by ID
   */
  async getSwapExecution(id: string): Promise<DBSwapExecution | null> {
    const result = await pool.query<DBSwapExecution>(
      'SELECT * FROM swap_executions WHERE id = $1',
      [id]
    );

    return result.rows[0] || null;
  }

  /**
   * Get swap executions for a node execution
   */
  async getSwapExecutionsForNode(
    nodeExecutionId: string
  ): Promise<DBSwapExecution[]> {
    const result = await pool.query<DBSwapExecution>(
      'SELECT * FROM swap_executions WHERE node_execution_id = $1 ORDER BY created_at DESC',
      [nodeExecutionId]
    );

    return result.rows;
  }
}

// Export singleton instance
export const swapExecutionService = new SwapExecutionService();

