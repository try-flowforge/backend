import { Contract } from 'ethers';
import {
  SwapProvider,
  SupportedChain,
  SwapInputConfig,
  SwapQuote,
  SwapTransaction,
  SwapType,
  TokenInfo,
} from '../../../types';
import { ISwapProvider } from '../interfaces/ISwapProvider';
import { getProvider } from '../../../config/providers';
import { CHAIN_CONFIGS } from '../../../config/chains';
import { logger } from '../../../utils/logger';

// Uniswap V3 SwapRouter02 ABI (minimal - for executing swaps)
const UNISWAP_V3_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
];

// Uniswap V3 Quoter V2 ABI (for getting quotes)
const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// Uniswap V3 fee tiers (in hundredths of a bip, i.e. 1e-6)
const FEE_TIERS = {
  LOWEST: 100,    // 0.01%
  LOW: 500,       // 0.05%
  MEDIUM: 3000,   // 0.3%
  HIGH: 10000,    // 1%
};

// Quoter V2 addresses for different chains
const QUOTER_V2_ADDRESSES: Record<string, string> = {
  [SupportedChain.ARBITRUM]: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  [SupportedChain.ARBITRUM_SEPOLIA]: '0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B',
};

/**
 * Uniswap V3 Provider Implementation
 * Uses SwapRouter02 for swaps and QuoterV2 for quotes
 */
export class UniswapProvider implements ISwapProvider {
  getName(): SwapProvider {
    return SwapProvider.UNISWAP;
  }

  supportsChain(chain: SupportedChain): boolean {
    // Uniswap V3 is available on Arbitrum mainnet and testnet
    return [
      SupportedChain.ARBITRUM,
      SupportedChain.ARBITRUM_SEPOLIA,
    ].includes(chain);
  }

  async getQuote(
    chain: SupportedChain,
    config: SwapInputConfig
  ): Promise<SwapQuote> {
    logger.debug({ chain, config }, 'Getting Uniswap V3 quote');

    const provider = getProvider(chain);
    const quoterAddress = QUOTER_V2_ADDRESSES[chain];

    if (!quoterAddress) {
      throw new Error(`Uniswap V3 Quoter not configured for chain: ${chain}`);
    }

    const quoter = new Contract(quoterAddress, UNISWAP_V3_QUOTER_ABI, provider);

    // Get token info if not provided
    const sourceToken = await this.getTokenInfo(
      chain,
      config.sourceToken.address
    );
    const destToken = await this.getTokenInfo(
      chain,
      config.destinationToken.address
    );

    try {
      // Try different fee tiers to find the best quote
      const feeResults = await this.tryMultipleFees(
        quoter,
        config,
        sourceToken,
        destToken
      );

      if (!feeResults || feeResults.length === 0) {
        throw new Error('No liquidity found for this token pair across all fee tiers');
      }

      // Select the best quote (highest output for exact input, lowest input for exact output)
      const bestQuote = this.selectBestQuote(feeResults, config.swapType);

      // Calculate price impact (simplified)
      const priceImpact = this.calculatePriceImpact(bestQuote.amountIn, bestQuote.amountOut);

      // Get gas price for cost estimation
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || BigInt(0);
      const estimatedGasCost = (BigInt(bestQuote.gasEstimate) * gasPrice).toString();

      const quote: SwapQuote = {
        provider: SwapProvider.UNISWAP,
        chain,
        sourceToken,
        destinationToken: destToken,
        amountIn: bestQuote.amountIn,
        amountOut: bestQuote.amountOut,
        estimatedAmountOut: bestQuote.estimatedAmountOut,
        route: [config.sourceToken.address, config.destinationToken.address],
        priceImpact,
        gasEstimate: bestQuote.gasEstimate,
        estimatedGasCost,
        validUntil: Date.now() + 30000, // 30 seconds
        rawQuote: {
          fee: bestQuote.fee,
          sqrtPriceX96After: bestQuote.sqrtPriceX96After,
          initializedTicksCrossed: bestQuote.initializedTicksCrossed,
        },
      };

      logger.debug({ quote }, 'Uniswap V3 quote generated');
      return quote;
    } catch (error) {
      logger.error({ error, chain, config }, 'Failed to get Uniswap V3 quote');
      throw new Error(`Failed to get Uniswap V3 quote: ${(error as Error).message}`);
    }
  }

  async buildTransaction(
    chain: SupportedChain,
    config: SwapInputConfig,
    quote?: SwapQuote
  ): Promise<SwapTransaction> {
    logger.debug({ chain, config }, 'Building Uniswap V3 transaction');

    const provider = getProvider(chain);
    const chainConfig = CHAIN_CONFIGS[chain];
    const routerAddress = chainConfig.contracts?.uniswapRouter;

    if (!routerAddress) {
      throw new Error(`Uniswap V3 router not configured for chain: ${chain}`);
    }

    const router = new Contract(routerAddress, UNISWAP_V3_ROUTER_ABI, provider);

    // Use fee from quote if available, otherwise default to MEDIUM (0.3%)
    const fee = quote?.rawQuote?.fee || FEE_TIERS.MEDIUM;

    // Calculate slippage
    const slippage = config.slippageTolerance || 0.5;

    let txData: string;

    if (config.swapType === SwapType.EXACT_INPUT) {
      // Calculate minimum output with slippage
      const expectedOut = quote?.amountOut || config.amount;
      const slippageMultiplier = 1 - slippage / 100;
      const minAmountOut = (
        BigInt(expectedOut) * BigInt(Math.floor(slippageMultiplier * 10000)) / BigInt(10000)
      ).toString();

      // Encode exactInputSingle
      const params = {
        tokenIn: config.sourceToken.address,
        tokenOut: config.destinationToken.address,
        fee: fee,
        recipient: config.recipient || config.walletAddress,
        amountIn: config.amount,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0, // No price limit
      };

      txData = router.interface.encodeFunctionData('exactInputSingle', [params]);
    } else {
      // Calculate maximum input with slippage
      const expectedIn = quote?.amountIn || config.amount;
      const slippageMultiplier = 1 + slippage / 100;
      const maxAmountIn = (
        BigInt(expectedIn) * BigInt(Math.floor(slippageMultiplier * 10000)) / BigInt(10000)
      ).toString();

      // Encode exactOutputSingle
      const params = {
        tokenIn: config.sourceToken.address,
        tokenOut: config.destinationToken.address,
        fee: fee,
        recipient: config.recipient || config.walletAddress,
        amountOut: config.amount,
        amountInMaximum: maxAmountIn,
        sqrtPriceLimitX96: 0, // No price limit
      };

      txData = router.interface.encodeFunctionData('exactOutputSingle', [params]);
    }

    // Get gas price
    const feeData = await provider.getFeeData();

    const transaction: SwapTransaction = {
      to: routerAddress,
      from: config.walletAddress,
      data: txData,
      value: '0', // ERC20 swap, no native token
      gasLimit: config.gasLimit || quote?.gasEstimate || '300000',
      maxFeePerGas: config.maxFeePerGas || feeData.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: config.maxPriorityFeePerGas || feeData.maxPriorityFeePerGas?.toString(),
      chainId: chainConfig.chainId,
    };

    logger.debug({ transaction }, 'Uniswap V3 transaction built');
    return transaction;
  }

  async simulateTransaction(
    chain: SupportedChain,
    transaction: SwapTransaction
  ): Promise<{ success: boolean; gasEstimate?: string; error?: string }> {
    try {
      const provider = getProvider(chain);

      // Estimate gas
      const gasEstimate = await provider.estimateGas({
        to: transaction.to,
        from: transaction.from,
        data: transaction.data,
        value: transaction.value,
      });

      logger.debug({ gasEstimate: gasEstimate.toString() }, 'Simulation successful');

      return {
        success: true,
        gasEstimate: gasEstimate.toString(),
      };
    } catch (error) {
      logger.error({ error }, 'Simulation failed');
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  async validateConfig(
    chain: SupportedChain,
    config: SwapInputConfig
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    // Validate chain support
    if (!this.supportsChain(chain)) {
      errors.push(`Uniswap does not support chain: ${chain}`);
    }

    // Validate addresses
    if (!config.sourceToken.address || config.sourceToken.address.length !== 42) {
      errors.push('Invalid source token address');
    }

    if (!config.destinationToken.address || config.destinationToken.address.length !== 42) {
      errors.push('Invalid destination token address');
    }

    // Validate amount
    if (!config.amount || BigInt(config.amount) <= BigInt(0)) {
      errors.push('Invalid swap amount');
    }

    // Validate slippage
    if (config.slippageTolerance !== undefined) {
      if (config.slippageTolerance < 0 || config.slippageTolerance > 50) {
        errors.push('Slippage tolerance must be between 0 and 50');
      }
    }

    // Validate wallet address
    if (!config.walletAddress || config.walletAddress.length !== 42) {
      errors.push('Invalid wallet address');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // Helper methods

  /**
   * Try to get quotes from multiple fee tiers and return all successful results
   */
  private async tryMultipleFees(
    quoter: Contract,
    config: SwapInputConfig,
    _sourceToken: TokenInfo,
    _destToken: TokenInfo
  ): Promise<any[]> {
    const fees = [FEE_TIERS.LOW, FEE_TIERS.MEDIUM, FEE_TIERS.HIGH];
    const results: any[] = [];

    for (const fee of fees) {
      try {
        let result;
        
        if (config.swapType === SwapType.EXACT_INPUT) {
          // Quote for exact input
          const params = {
            tokenIn: config.sourceToken.address,
            tokenOut: config.destinationToken.address,
            amountIn: config.amount,
            fee: fee,
            sqrtPriceLimitX96: 0,
          };

          result = await quoter.quoteExactInputSingle.staticCall(params);
          
          const slippage = config.slippageTolerance || 0.5;
          const slippageMultiplier = 1 - slippage / 100;
          
          results.push({
            fee,
            amountIn: config.amount,
            amountOut: result[0].toString(),
            estimatedAmountOut: (
              BigInt(result[0]) * BigInt(Math.floor(slippageMultiplier * 10000)) / BigInt(10000)
            ).toString(),
            sqrtPriceX96After: result[1].toString(),
            initializedTicksCrossed: result[2].toString(),
            gasEstimate: result[3].toString(),
          });
        } else {
          // Quote for exact output
          const params = {
            tokenIn: config.sourceToken.address,
            tokenOut: config.destinationToken.address,
            amount: config.amount,
            fee: fee,
            sqrtPriceLimitX96: 0,
          };

          result = await quoter.quoteExactOutputSingle.staticCall(params);
          
          const slippage = config.slippageTolerance || 0.5;
          const slippageMultiplier = 1 + slippage / 100;
          
          results.push({
            fee,
            amountIn: result[0].toString(),
            amountOut: config.amount,
            estimatedAmountOut: (
              BigInt(result[0]) * BigInt(Math.floor(slippageMultiplier * 10000)) / BigInt(10000)
            ).toString(),
            sqrtPriceX96After: result[1].toString(),
            initializedTicksCrossed: result[2].toString(),
            gasEstimate: result[3].toString(),
          });
        }

        logger.debug({ fee, result: results[results.length - 1] }, 'Quote successful for fee tier');
      } catch (error) {
        logger.debug({ fee, error: (error as Error).message }, 'Quote failed for fee tier');
        // Continue to next fee tier
      }
    }

    return results;
  }

  /**
   * Select the best quote from multiple fee tier results
   */
  private selectBestQuote(results: any[], swapType: SwapType): any {
    if (results.length === 0) {
      throw new Error('No valid quotes found');
    }

    if (swapType === SwapType.EXACT_INPUT) {
      // For exact input, select the quote with highest output
      return results.reduce((best, current) => 
        BigInt(current.amountOut) > BigInt(best.amountOut) ? current : best
      );
    } else {
      // For exact output, select the quote with lowest input
      return results.reduce((best, current) => 
        BigInt(current.amountIn) < BigInt(best.amountIn) ? current : best
      );
    }
  }

  private async getTokenInfo(chain: SupportedChain, address: string): Promise<TokenInfo> {
    try {
      const provider = getProvider(chain);
      const token = new Contract(address, ERC20_ABI, provider);

      const [decimals, symbol, name] = await Promise.all([
        token.decimals(),
        token.symbol(),
        token.name(),
      ]);

      return {
        address,
        decimals: Number(decimals),
        symbol,
        name,
      };
    } catch (error) {
      logger.warn({ error, address }, 'Failed to get token info');
      return {
        address,
      };
    }
  }

  private calculatePriceImpact(amountIn: string, amountOut: string): string {
    // Simplified price impact calculation
    // In production, you'd want to compare against spot price
    try {
      const impact = (BigInt(amountIn) * BigInt(100)) / BigInt(amountOut);
      return (Number(impact) / 100).toFixed(2);
    } catch {
      return '0';
    }
  }
}
