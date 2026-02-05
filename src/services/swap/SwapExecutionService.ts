import {
  SwapProvider,
  SupportedChain,
  SwapInputConfig,
  SwapQuote,
  // SwapTransaction,
  SwapExecutionResult,
  ExecutionStatus,
  DBSwapExecution,
  SafeTransactionHashResult,
} from '../../types';
import { swapProviderFactory } from './providers/SwapProviderFactory';
import { waitForTransaction } from '../../config/providers';
import { SECURITY_CONFIG, VALIDATION_CONFIG, CHAIN_CONFIGS } from '../../config/chains';
import { logger } from '../../utils/logger';
import { pool } from '../../config/database';
import { redisClient } from '../../config/redis';
import { getRelayerService } from '../relayer.service';
import { SupportedChainId } from '../../config/config';
import { getSafeTransactionService } from '../safe-transaction.service';
import { UserModel } from '../../models/users/user.model';
import { ethers } from 'ethers';

/**
 * Swap Execution Service
 * Handles the complete lifecycle of swap executions with validation, security, and error handling
 */
export class SwapExecutionService {
  /**
   * `swap_executions.node_execution_id` is a UUID column in Postgres.
   * Older callers used a prefixed id format like `swap-<uuid>`.
   * Normalize to the raw UUID so inserts/queries don't error with `22P02`.
   */
  private normalizeNodeExecutionId(nodeExecutionId: string): string {
    if (!nodeExecutionId) return nodeExecutionId;
    return nodeExecutionId.startsWith('swap-')
      ? nodeExecutionId.slice('swap-'.length)
      : nodeExecutionId;
  }

  private isForeignKeyViolationOnNodeExecutions(err: unknown): boolean {
    const e: any = err;
    return (
      e &&
      e.code === '23503' &&
      (e.constraint === 'swap_executions_node_execution_id_fkey' ||
        String(e.detail || '').includes('is not present in table "node_executions"'))
    );
  }

  private safeTxCacheKey(nodeExecutionId: string): string {
    return `safe_tx:${nodeExecutionId}`;
  }

  /**
   * Determine which address needs ERC20 allowance for a given swap provider.
   * - UNISWAP: Uniswap router
   * - LIFI: LI.FI returns an approvalAddress (spender). Fallback to tx.to.
   */
  private getApprovalSpenderAddress(params: {
    chain: SupportedChain;
    provider: SwapProvider;
    quote: SwapQuote;
    transactionTo: string;
  }): string {
    const { chain, provider, quote, transactionTo } = params;

    if (provider === SwapProvider.LIFI) {
      const approvalAddress = (quote as any)?.rawQuote?.estimate?.approvalAddress;
      return approvalAddress || transactionTo;
    }

    const routerAddress = CHAIN_CONFIGS[chain].contracts?.uniswapRouter;
    if (!routerAddress) {
      throw new Error(`Uniswap router address not configured for chain ${chain}`);
    }
    return routerAddress;
  }
  
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
   * Build Safe transaction hash for user to sign
   * Returns transaction hash and data that frontend needs to sign
   */
  async buildSwapTransactionForSigning(
    nodeExecutionId: string,
    chain: SupportedChain,
    provider: SwapProvider,
    config: SwapInputConfig,
    userId: string
  ): Promise<SafeTransactionHashResult> {
    const chainId = CHAIN_CONFIGS[chain].chainId as SupportedChainId;
    const safeTransactionService = getSafeTransactionService();

    logger.info(
      {
        nodeExecutionId,
        chain,
        chainId,
        provider,
        userId,
      },
      'Building Safe transaction hash for user signing'
    );

    // Get user's Safe wallet address
    const safeAddress = await UserModel.getSafeAddressByChain(userId, chainId);
    if (!safeAddress) {
      throw new Error(
        `Safe wallet not found for user ${userId} on chain ${chainId}. ` +
        `Please create a Safe wallet first via /api/v1/relay/create-safe`
      );
    }

    // Update config to use Safe as recipient
    const swapConfig: SwapInputConfig = {
      ...config,
      recipient: safeAddress,
    };

    // Validate configuration
    const validation = await this.validateSwapConfig(chain, provider, swapConfig);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    // Get provider and quote
    const swapProvider = swapProviderFactory.getProvider(provider);
    const quote = await swapProvider.getQuote(chain, swapConfig);
    const transaction = await swapProvider.buildTransaction(chain, swapConfig, quote);

    // Check if we need ERC20 approval
    const isNativeToken = this.isNativeToken(swapConfig.sourceToken.address, chain);
    let needsApproval = false;
    let approvalData: string | null = null;

    if (!isNativeToken) {
      const spenderAddress = this.getApprovalSpenderAddress({
        chain,
        provider,
        quote,
        transactionTo: transaction.to,
      });

      const currentAllowance = await safeTransactionService.checkTokenAllowance(
        swapConfig.sourceToken.address,
        safeAddress,
        spenderAddress,
        chainId
      );

      const requiredAmount = BigInt(swapConfig.amount);
      needsApproval = currentAllowance < requiredAmount;

      if (needsApproval) {
        const ERC20_ABI = [
          "function approve(address spender, uint256 amount) returns (bool)",
        ];
        const iface = new ethers.Interface(ERC20_ABI);
        approvalData = iface.encodeFunctionData("approve", [
          spenderAddress,
          ethers.MaxUint256,
        ]);
      }
    }

    // Build Safe transaction data (multicall if approval needed, otherwise just swap)
    let safeTxData: {
      to: string;
      value: bigint;
      data: string;
    };
    // Safe tx operation: 0 = CALL, 1 = DELEGATECALL
    let safeTxOperation = 0;

    if (needsApproval && approvalData) {
      // Build multicall transaction (approve + swap)
      safeTxData = safeTransactionService.buildMulticallTransaction(
        {
          to: swapConfig.sourceToken.address,
          value: 0n,
          data: approvalData,
        },
        {
          to: transaction.to,
          value: BigInt(transaction.value || '0'),
          data: transaction.data,
        },
        chainId
      );
      // MultiSend must be executed via DELEGATECALL from the Safe
      safeTxOperation = 1;
    } else {
      // Just swap transaction
      safeTxData = {
        to: transaction.to,
        value: BigInt(transaction.value || '0'),
        data: transaction.data,
      };
      safeTxOperation = 0;
    }

    // Build Safe transaction hash
    const safeTxHash = await safeTransactionService.buildSafeTransactionHash(
      safeAddress,
      chainId,
      safeTxData.to,
      safeTxData.value,
      safeTxData.data,
      safeTxOperation
    );

    logger.info(
      {
        safeAddress,
        safeTxHash,
        needsApproval,
        chainId,
      },
      'Safe transaction hash built for signing'
    );

    // Cache the exact Safe tx payload used to produce the hash.
    // This prevents mismatches where execute step rebuilds a slightly different tx (deadline/route/etc),
    // which would invalidate the user signature and revert (e.g. GS013).
    try {
      await redisClient.set(
        this.safeTxCacheKey(nodeExecutionId),
        JSON.stringify({
          chain,
          provider,
          chainId,
          safeAddress,
          safeTxHash,
          safeTxData: {
            to: safeTxData.to,
            value: safeTxData.value.toString(),
            data: safeTxData.data,
            operation: safeTxOperation,
          },
          cachedAt: Date.now(),
        }),
        {
          EX: 10 * 60, // 10 minutes
        }
      );
    } catch (e) {
      logger.warn({ error: e, nodeExecutionId }, 'Failed to cache Safe tx payload');
    }

    return {
      safeTxHash,
      safeAddress,
      safeTxData: {
        to: safeTxData.to,
        value: safeTxData.value.toString(),
        data: safeTxData.data,
        operation: safeTxOperation,
      },
      needsApproval,
      tokenAddress: needsApproval ? swapConfig.sourceToken.address : undefined,
    };
  }

  /**
   * Execute a swap with user signature (signature-based flow)
   * User must have signed the transaction hash first
   */
  async executeSwapWithSignature(
    nodeExecutionId: string,
    chain: SupportedChain,
    provider: SwapProvider,
    config: SwapInputConfig,
    userId: string,
    signature: string // EIP-712 signature from user
  ): Promise<SwapExecutionResult> {
    const normalizedNodeExecutionId = this.normalizeNodeExecutionId(nodeExecutionId);
    const chainId = CHAIN_CONFIGS[chain].chainId as SupportedChainId;
    const safeTransactionService = getSafeTransactionService();

    logger.info(
      {
        nodeExecutionId: normalizedNodeExecutionId,
        chain,
        chainId,
        provider,
        userId,
      },
      'Executing swap with user signature'
    );

    const startTime = Date.now();
    let swapExecutionId: string | null = null;

    try {
      // Prefer cached Safe tx payload from the "build" step to avoid rebuilding a different tx.
      let cachedSafe: any | null = null;
      try {
        const cached = await redisClient.get(this.safeTxCacheKey(nodeExecutionId));
        cachedSafe = cached ? JSON.parse(cached) : null;
      } catch (e) {
        logger.warn({ error: e, nodeExecutionId }, 'Failed to read cached Safe tx payload');
      }

      // Get user's Safe wallet address
      const safeAddress = await UserModel.getSafeAddressByChain(userId, chainId);
      if (!safeAddress) {
        throw new Error(
          `Safe wallet not found for user ${userId} on chain ${chainId}`
        );
      }

      // Update config to use Safe as recipient (kept for response + basic validation)
      const swapConfig: SwapInputConfig = { ...config, recipient: safeAddress };

      // Validate configuration (non-authoritative; actual tx payload comes from cached Safe tx if present)
      const validation = await this.validateSwapConfig(chain, provider, swapConfig);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Create swap execution record
      try {
        swapExecutionId = await this.createSwapExecutionRecord(
          normalizedNodeExecutionId,
          chain,
          provider,
          swapConfig
        );
      } catch (err) {
        // "Test transaction" calls can run outside WorkflowExecutionEngine, so there may be no node_executions row.
        // In that case we still want to execute the swap; we just won't persist `swap_executions`.
        if (this.isForeignKeyViolationOnNodeExecutions(err)) {
          logger.warn(
            { nodeExecutionId: normalizedNodeExecutionId, err },
            'No node_executions row for nodeExecutionId; skipping swap_executions persistence for this run'
          );
          swapExecutionId = null;
        } else {
          throw err;
        }
      }

      // Use cached Safe transaction payload if available; otherwise fall back to rebuilding (may revert if provider tx changes).
      const effectiveSafeTxData =
        cachedSafe?.safeTxData?.to &&
        cachedSafe?.safeTxData?.data &&
        cachedSafe?.safeTxData?.value !== undefined
          ? {
              to: cachedSafe.safeTxData.to as string,
              value: BigInt(cachedSafe.safeTxData.value as string),
              data: cachedSafe.safeTxData.data as string,
              operation: Number(cachedSafe.safeTxData.operation ?? 0),
            }
          : null;

      if (!effectiveSafeTxData) {
        logger.warn(
          { nodeExecutionId, normalizedNodeExecutionId },
          'No cached Safe tx payload found; rebuilding tx for execution (signature may not match)'
        );
      }

      // Execute Safe transaction with user signature
      logger.info(
        {
          safeAddress,
          chainId,
          needsApproval: cachedSafe?.needsApproval,
        },
        'Executing Safe transaction with user signature'
      );

      const result = await safeTransactionService.executeWithSignatures(
        safeAddress,
        chainId,
        effectiveSafeTxData ? effectiveSafeTxData.to : (() => { throw new Error('Missing cached Safe transaction payload'); })(),
        effectiveSafeTxData ? effectiveSafeTxData.value : 0n,
        effectiveSafeTxData ? effectiveSafeTxData.data : '0x',
        effectiveSafeTxData ? effectiveSafeTxData.operation : 0,
        signature,
        cachedSafe?.safeTxHash,
        0n, // safeTxGas
        0n, // baseGas
        0n, // gasPrice
        ethers.ZeroAddress, // gasToken
        ethers.ZeroAddress // refundReceiver
      );

      const txHash = result.txHash;

      // Update swap execution with tx hash
      if (swapExecutionId) {
        await this.updateSwapExecution(swapExecutionId, {
          tx_hash: txHash,
          status: ExecutionStatus.RUNNING,
        });
      }

      // Wait for confirmation
      logger.info('Waiting for transaction confirmation...');
      const receipt = await waitForTransaction(chain, txHash, 1);

      if (!receipt) {
        throw new Error('Transaction receipt not found');
      }

      // Calculate execution result
      const executionResult: SwapExecutionResult = {
        success: true,
        txHash: receipt.hash,
        fromToken: config.sourceToken,
        toToken: config.destinationToken,
        amountIn: config.amount,
        // We intentionally do not rebuild quotes/tx data during execution (to avoid signature mismatch).
        // So amountOut is unknown here unless parsed from logs; keep it undefined.
        amountOut: undefined,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice?.toString(),
        blockNumber: receipt.blockNumber,
        timestamp: new Date(),
        status: ExecutionStatus.SUCCESS,
      };

      // Update swap execution record
      if (swapExecutionId) {
        await this.updateSwapExecution(swapExecutionId, {
          amount_out: undefined,
          gas_used: executionResult.gasUsed,
          effective_gas_price: executionResult.effectiveGasPrice,
          block_number: executionResult.blockNumber,
          status: ExecutionStatus.SUCCESS,
          completed_at: new Date(),
        });
      }

      // Update rate limiting
      await this.recordSwapExecution(safeAddress);

      logger.info(
        {
          txHash: executionResult.txHash,
          duration: Date.now() - startTime,
        },
        'Swap executed successfully with signature'
      );

      return executionResult;
    } catch (error) {
      logger.error({ error, nodeExecutionId }, 'Swap execution with signature failed');

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
   * Execute a swap using Safe wallet via gasless relayer
   * The relayer wallet pays gas, and swap output goes to user's Safe wallet
   * 
   * @param userId User ID to lookup Safe wallet address
   * @param signature Optional signature - if provided, uses signature-based flow
   */
  async executeSwap(
    nodeExecutionId: string,
    chain: SupportedChain,
    provider: SwapProvider,
    config: SwapInputConfig,
    userId?: string, // User ID for Safe wallet lookup
    signature?: string, // Optional: If provided, uses signature-based execution
  ): Promise<SwapExecutionResult> {
    const normalizedNodeExecutionId = this.normalizeNodeExecutionId(nodeExecutionId);
    // Get chainId for relayer service
    const chainId = CHAIN_CONFIGS[chain].chainId as SupportedChainId;
    const relayerService = getRelayerService();
    const safeTransactionService = getSafeTransactionService();

    logger.info(
      {
        nodeExecutionId: normalizedNodeExecutionId,
        chain,
        chainId,
        provider,
        walletAddress: config.walletAddress,
        userId,
        relayerAddress: relayerService.getAddress(chainId),
      },
      'Starting swap execution via Safe wallet (gasless mode)'
    );

    const startTime = Date.now();
    let swapExecutionId: string | null = null;

    try {
      // Get user's Safe wallet address
      let safeAddress: string | null = null;
      if (userId) {
        safeAddress = await UserModel.getSafeAddressByChain(userId, chainId);
        if (!safeAddress) {
          throw new Error(
            `Safe wallet not found for user ${userId} on chain ${chainId}. ` +
            `Please create a Safe wallet first via /api/v1/relay/create-safe`
          );
        }
        logger.info(
          { userId, safeAddress, chainId },
          'Found Safe wallet address for user'
        );
      } else {
        logger.warn(
          { nodeExecutionId: normalizedNodeExecutionId },
          'No userId provided, falling back to direct execution (not via Safe)'
        );
      }

      // Update config to use Safe as recipient if Safe address is available
      const swapConfig: SwapInputConfig = {
        ...config,
        recipient: safeAddress || config.recipient || config.walletAddress,
      };
      
      // Validate configuration
      const validation = await this.validateSwapConfig(chain, provider, swapConfig);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Create swap execution record (use Safe address if available)
      swapExecutionId = await this.createSwapExecutionRecord(
        normalizedNodeExecutionId,
        chain,
        provider,
        swapConfig
      );

      // Get provider
      const swapProvider = swapProviderFactory.getProvider(provider);

      // Get quote
      logger.debug('Getting quote...');
      const quote = await swapProvider.getQuote(chain, swapConfig);

      // Build transaction
      logger.debug('Building transaction...');
      const transaction = await swapProvider.buildTransaction(chain, swapConfig, quote);

      // Simulate transaction if enabled (default: true)
      if (swapConfig.simulateFirst !== false) {
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

      let txHash: string;

      // Execute via Safe if Safe address is available
      if (safeAddress) {
        // Check if we need ERC20 approval (for non-native tokens)
        const isNativeToken = this.isNativeToken(swapConfig.sourceToken.address, chain);
        let needsApproval = false;
        let approvalData: string | null = null;

        if (!isNativeToken) {
          const spenderAddress = this.getApprovalSpenderAddress({
            chain,
            provider,
            quote,
            transactionTo: transaction.to,
          });

          // Check current allowance
          const currentAllowance = await safeTransactionService.checkTokenAllowance(
            swapConfig.sourceToken.address,
            safeAddress,
            spenderAddress,
            chainId
          );
          const requiredAmount = BigInt(swapConfig.amount);
          needsApproval = currentAllowance < requiredAmount;

          if (needsApproval) {
            logger.info(
              {
                tokenAddress: swapConfig.sourceToken.address,
                safeAddress,
                spenderAddress,
                currentAllowance: currentAllowance.toString(),
                requiredAmount: requiredAmount.toString(),
              },
              'ERC20 approval needed, will combine with swap via multicall'
            );

            // Build approve transaction
            const ERC20_ABI = [
              "function approve(address spender, uint256 amount) returns (bool)",
            ];
            const iface = new ethers.Interface(ERC20_ABI);
            // Approve max uint256 for convenience (one-time approval)
            approvalData = iface.encodeFunctionData("approve", [
              spenderAddress,
              ethers.MaxUint256,
            ]);
          }
        }

        // Build Safe transaction data
        let safeTxData: {
          to: string;
          value: bigint;
          data: string;
        };

        if (needsApproval && approvalData) {
          // Build multicall transaction (approve + swap)
          safeTxData = safeTransactionService.buildMulticallTransaction(
            {
              to: swapConfig.sourceToken.address,
              value: 0n,
              data: approvalData,
            },
            {
              to: transaction.to,
              value: BigInt(transaction.value || '0'),
              data: transaction.data,
            },
            chainId
          );
        } else {
          // Just swap transaction
          safeTxData = {
            to: transaction.to,
            value: BigInt(transaction.value || '0'),
            data: transaction.data,
          };
        }

        // Execute with signature if provided, otherwise throw error (signature required)
        if (signature) {
          logger.info(
            {
              chainId,
              safeAddress,
              needsApproval,
            },
            'Executing Safe transaction with user signature'
          );

          const result = await safeTransactionService.executeWithSignatures(
            safeAddress,
            chainId,
            safeTxData.to,
            safeTxData.value,
            safeTxData.data,
            0, // CALL operation
            signature,
            undefined,
            0n, // safeTxGas
            0n, // baseGas
            0n, // gasPrice
            ethers.ZeroAddress, // gasToken
            ethers.ZeroAddress // refundReceiver
          );

          txHash = result.txHash;
          logger.info(
            { txHash, safeAddress, needsApproval },
            'Safe transaction executed with signature'
          );
        } else {
          // No signature provided - need to build hash for user to sign
          const safeTxHash = await safeTransactionService.buildSafeTransactionHash(
            safeAddress,
            chainId,
            safeTxData.to,
            safeTxData.value,
            safeTxData.data,
            0 // CALL operation
          );

          // Return result indicating signature is required
          return {
            success: false,
            fromToken: config.sourceToken,
            toToken: config.destinationToken,
            amountIn: config.amount,
            timestamp: new Date(),
            status: ExecutionStatus.PENDING,
            requiresSignature: true,
            safeTxHash,
            safeTxData: {
              to: safeTxData.to,
              value: safeTxData.value.toString(),
              data: safeTxData.data,
              operation: 0,
            },
            errorMessage: 'User signature required. Please sign the transaction hash and call executeSwapWithSignature.',
            errorCode: 'SIGNATURE_REQUIRED',
          };
        }
      } else {
        // Fallback to direct execution (for backwards compatibility)
        logger.info({
          chainId,
          relayerAddress: relayerService.getAddress(chainId),
        }, 'Sending transaction directly via relayer (no Safe wallet)...');

        const result = await relayerService.sendTransaction(
          chainId,
          transaction.to,
          transaction.data,
          BigInt(transaction.value || '0')
        );

        txHash = result.txHash;
        logger.info({ txHash }, 'Direct transaction sent');
      }

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

      // Update rate limiting (use Safe address if available, otherwise wallet address)
      await this.recordSwapExecution(safeAddress || config.walletAddress);

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
    const normalizedNodeExecutionId = this.normalizeNodeExecutionId(nodeExecutionId);
    const result = await pool.query<DBSwapExecution>(
      'SELECT * FROM swap_executions WHERE node_execution_id = $1 ORDER BY created_at DESC',
      [normalizedNodeExecutionId]
    );

    return result.rows;
  }

  /**
   * Check if token is native (ETH) or WETH
   */
  private isNativeToken(tokenAddress: string, chain: SupportedChain): boolean {
    const chainConfig = CHAIN_CONFIGS[chain];
    const wethAddress = chainConfig.contracts?.weth?.toLowerCase();
    const tokenLower = tokenAddress.toLowerCase();

    // Check if it's zero address (native ETH) or WETH
    return (
      tokenLower === ethers.ZeroAddress.toLowerCase() ||
      (wethAddress !== undefined && tokenLower === wethAddress)
    );
  }
}

// Export singleton instance
export const swapExecutionService = new SwapExecutionService();

