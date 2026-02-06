import { AbiCoder, Contract, Interface } from 'ethers';
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

// Uniswap V4 Quoter ABI - quoteExactInputSingle returns (uint256 amountOut, uint256 gasEstimate)
const V4_QUOTER_ABI = [
  'function quoteExactInputSingle((tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData)) external returns (uint256 amountOut, uint256 gasEstimate)',
  'function quoteExactOutputSingle((tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData)) external returns (uint256 amountIn, uint256 gasEstimate)',
];

// Uniswap V4 PoolSwapTest ABI
const V4_POOL_SWAP_TEST_ABI = [
  'function swap(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, tuple(bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, tuple(bool takeClaims, bool settleUsingBurn) testSettings, bytes hookData) external payable returns (tuple(int256 amount0, int256 amount1) delta)',
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

// Uniswap V4 fee tiers: fee (hundredths of bip) -> tickSpacing
const FEE_TIERS: { fee: number; tickSpacing: number }[] = [
  { fee: 100, tickSpacing: 1 },    // 0.01%
  { fee: 500, tickSpacing: 10 },   // 0.05%
  { fee: 3000, tickSpacing: 60 },  // 0.3%
  { fee: 10000, tickSpacing: 200 }, // 1%
];

const HOOKS_ZERO = '0x0000000000000000000000000000000000000000';
const HOOK_DATA = '0x';

// Universal Router: V4_SWAP command and V4Router actions (see Actions.sol)
const COMMAND_V4_SWAP = 0x10;
const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const ACTION_SETTLE_ALL = 0x0c;
const ACTION_TAKE_ALL = 0x0f;
const ACTION_SWAP_EXACT_OUT_SINGLE = 0x08;

const UNIVERSAL_ROUTER_ABI = [
  'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) payable',
];

/**
 * Uniswap V4 Provider Implementation
 * Uses V4Quoter for quotes. Builds swap via Universal Router (with Permit2) when configured,
 * otherwise falls back to PoolSwapTest (testnets only).
 * See: https://docs.uniswap.org/contracts/v4/deployments
 */
export class UniswapV4Provider implements ISwapProvider {
  getName(): SwapProvider {
    return SwapProvider.UNISWAP_V4;
  }

  supportsChain(chain: SupportedChain): boolean {
    return [
      SupportedChain.ARBITRUM,
      SupportedChain.ARBITRUM_SEPOLIA,
      SupportedChain.ETHEREUM,
      SupportedChain.ETHEREUM_SEPOLIA,
      SupportedChain.UNICHAIN,
      SupportedChain.UNICHAIN_SEPOLIA,
    ].includes(chain);
  }

  async getQuote(
    chain: SupportedChain,
    config: SwapInputConfig
  ): Promise<SwapQuote> {
    logger.debug({ chain, config }, 'Getting Uniswap V4 quote');

    const quoterAddress = CHAIN_CONFIGS[chain]?.contracts?.uniswapV4Quoter;
    if (!quoterAddress) {
      throw new Error(`Uniswap V4 Quoter not configured for chain: ${chain}`);
    }

    const provider = getProvider(chain);
    const quoter = new Contract(quoterAddress, V4_QUOTER_ABI, provider);

    const sourceToken = await this.getTokenInfo(chain, config.sourceToken.address);
    const destToken = await this.getTokenInfo(chain, config.destinationToken.address);

    const { poolKey, zeroForOne } = this.buildPoolKey(
      config.sourceToken.address,
      config.destinationToken.address
    );

    try {
      const feeResults = await this.tryMultipleFees(quoter, config, poolKey, zeroForOne);

      if (!feeResults || feeResults.length === 0) {
        throw new Error(
          'No Uniswap V4 pool exists for this token pair, or no liquidity found across fee tiers'
        );
      }

      const bestQuote = this.selectBestQuote(feeResults, config.swapType);
      const slippage = config.slippageTolerance || 0.5;
      const slippageMultiplier = 1 - slippage / 100;
      const estimatedAmountOut = (
        BigInt(bestQuote.amountOut) *
        BigInt(Math.floor(slippageMultiplier * 10000)) /
        BigInt(10000)
      ).toString();

      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || BigInt(0);
      const estimatedGasCost = (BigInt(bestQuote.gasEstimate) * gasPrice).toString();

      const quote: SwapQuote = {
        provider: SwapProvider.UNISWAP_V4,
        chain,
        sourceToken,
        destinationToken: destToken,
        amountIn: bestQuote.amountIn,
        amountOut: bestQuote.amountOut,
        estimatedAmountOut,
        route: [config.sourceToken.address, config.destinationToken.address],
        priceImpact: this.calculatePriceImpact(bestQuote.amountIn, bestQuote.amountOut),
        gasEstimate: bestQuote.gasEstimate,
        estimatedGasCost,
        validUntil: Date.now() + 30000,
        rawQuote: {
          fee: bestQuote.fee,
          tickSpacing: bestQuote.tickSpacing,
          zeroForOne,
        },
      };

      logger.debug({ quote }, 'Uniswap V4 quote generated');
      return quote;
    } catch (error) {
      const msg = (error as Error).message;
      logger.error({ error, chain, config }, 'Failed to get Uniswap V4 quote');
      if (msg.includes('PoolNotInitialized') || msg.includes('No pool') || msg.includes('LIQUIDITY')) {
        throw new Error(
          `No Uniswap V4 pool exists for this token pair on ${chain}. Create a V4 pool or use a pair with liquidity.`
        );
      }
      throw new Error(`Failed to get Uniswap V4 quote: ${msg}`);
    }
  }

  async buildTransaction(
    chain: SupportedChain,
    config: SwapInputConfig,
    quote?: SwapQuote
  ): Promise<SwapTransaction> {
    logger.debug({ chain, config }, 'Building Uniswap V4 transaction');

    const chainConfig = CHAIN_CONFIGS[chain];
    const universalRouter = chainConfig?.contracts?.universalRouter;
    const poolSwapTestAddress = chainConfig?.contracts?.uniswapV4PoolSwapTest;
    const zero = '0x0000000000000000000000000000000000000000';

    const { poolKey, zeroForOne } = this.buildPoolKey(
      config.sourceToken.address,
      config.destinationToken.address
    );

    const fee = quote?.rawQuote?.fee ?? 3000;
    const tickSpacing = FEE_TIERS.find((t) => t.fee === fee)?.tickSpacing ?? 60;
    const slippage = config.slippageTolerance ?? 0.5;
    const slippageMultiplier = 1 - slippage / 100;
    const amountIn = config.amount;
    const amountOutRaw = quote?.amountOut ?? '0';
    const minAmountOut = (
      (BigInt(amountOutRaw) * BigInt(Math.floor(slippageMultiplier * 10000))) /
      BigInt(10000)
    ).toString();

    // Prefer Universal Router when configured (Permit2-based flow)
    if (universalRouter && universalRouter !== '0x0' && universalRouter.toLowerCase() !== zero) {
      const txData = this.encodeUniversalRouterV4Swap(
        poolKey.currency0,
        poolKey.currency1,
        fee,
        tickSpacing,
        zeroForOne,
        config.swapType,
        amountIn,
        minAmountOut,
        config.sourceToken.address,
        config.destinationToken.address
      );

      const feeData = await getProvider(chain).getFeeData();
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min

      const iface = new Interface(UNIVERSAL_ROUTER_ABI);
      const executeData = iface.encodeFunctionData('execute', [
        '0x' + COMMAND_V4_SWAP.toString(16).padStart(2, '0'),
        [txData],
        deadline,
      ]);

      const transaction: SwapTransaction = {
        to: universalRouter,
        from: config.walletAddress,
        data: executeData,
        value: '0',
        gasLimit: config.gasLimit || quote?.gasEstimate || '400000',
        maxFeePerGas: config.maxFeePerGas || feeData.maxFeePerGas?.toString(),
        maxPriorityFeePerGas:
          config.maxPriorityFeePerGas || feeData.maxPriorityFeePerGas?.toString(),
        chainId: chainConfig.chainId,
      };

      logger.debug({ transaction }, 'Uniswap V4 transaction built (Universal Router)');
      return transaction;
    }

    // Fallback: PoolSwapTest (testnets only)
    if (!poolSwapTestAddress || poolSwapTestAddress === '0x0' || poolSwapTestAddress.toLowerCase() === zero) {
      throw new Error(
        `Uniswap V4: neither Universal Router nor PoolSwapTest configured for chain: ${chain}. Set universalRouter in chain config.`
      );
    }

    const key = {
      currency0: poolKey.currency0,
      currency1: poolKey.currency1,
      fee,
      tickSpacing,
      hooks: HOOKS_ZERO,
    };

    let amountSpecified: bigint;
    if (config.swapType === SwapType.EXACT_INPUT) {
      amountSpecified = -BigInt(config.amount);
    } else {
      amountSpecified = BigInt(config.amount);
    }

    const params = {
      zeroForOne,
      amountSpecified,
      sqrtPriceLimitX96: 0,
    };

    const testSettings = {
      takeClaims: true,
      settleUsingBurn: false,
    };

    const iface = new Interface(V4_POOL_SWAP_TEST_ABI);
    const txData = iface.encodeFunctionData('swap', [
      key,
      params,
      testSettings,
      HOOK_DATA,
    ]);

    const feeData = await getProvider(chain).getFeeData();

    const transaction: SwapTransaction = {
      to: poolSwapTestAddress,
      from: config.walletAddress,
      data: txData,
      value: '0',
      gasLimit: config.gasLimit || quote?.gasEstimate || '400000',
      maxFeePerGas: config.maxFeePerGas || feeData.maxFeePerGas?.toString(),
      maxPriorityFeePerGas:
        config.maxPriorityFeePerGas || feeData.maxPriorityFeePerGas?.toString(),
      chainId: chainConfig.chainId,
    };

    logger.debug({ transaction }, 'Uniswap V4 transaction built (PoolSwapTest)');
    return transaction;
  }

  /**
   * Encode V4_SWAP input for Universal Router: (bytes actions, bytes[] params).
   * Actions: SWAP_EXACT_IN_SINGLE (0x06), SETTLE_ALL (0x0c), TAKE_ALL (0x0f).
   * Params: [ExactInputSingleParams, (currencySettle, amountIn), (currencyTake, minOut)].
   */
  private encodeUniversalRouterV4Swap(
    currency0: string,
    currency1: string,
    fee: number,
    tickSpacing: number,
    zeroForOne: boolean,
    swapType: SwapType,
    amountIn: string,
    minAmountOut: string,
    sourceToken: string,
    destToken: string
  ): string {
    const coder = AbiCoder.defaultAbiCoder();

    // Exact input: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
    const actionSwap = swapType === SwapType.EXACT_INPUT ? ACTION_SWAP_EXACT_IN_SINGLE : ACTION_SWAP_EXACT_OUT_SINGLE;
    const actions = '0x' +
      actionSwap.toString(16).padStart(2, '0') +
      ACTION_SETTLE_ALL.toString(16).padStart(2, '0') +
      ACTION_TAKE_ALL.toString(16).padStart(2, '0');

    // PoolKey: (currency0, currency1, fee, tickSpacing, hooks)
    const poolKeyTuple = [currency0, currency1, fee, tickSpacing, HOOKS_ZERO];

    // ExactInputSingleParams: (poolKey, zeroForOne, amountIn, amountOutMinimum, hookData)
    const exactInputParams = [
      poolKeyTuple,
      zeroForOne,
      amountIn,
      minAmountOut,
      HOOK_DATA,
    ];
    const param0 = coder.encode(
      ['tuple(address,address,uint24,int24,address)', 'bool', 'uint128', 'uint128', 'bytes'],
      exactInputParams
    );

    // SETTLE_ALL: (currency, amount) - the input token we pay
    const param1 = coder.encode(
      ['address', 'uint256'],
      [sourceToken, amountIn]
    );

    // TAKE_ALL: (currency, amount) - the output token we receive (min amount)
    const param2 = coder.encode(
      ['address', 'uint256'],
      [destToken, minAmountOut]
    );

    // V4_SWAP single input: abi.encode(bytes actions, bytes[] params)
    return coder.encode(
      ['bytes', 'bytes[]'],
      [actions, [param0, param1, param2]]
    );
  }

  async simulateTransaction(
    chain: SupportedChain,
    transaction: SwapTransaction
  ): Promise<{ success: boolean; gasEstimate?: string; error?: string }> {
    try {
      const provider = getProvider(chain);
      const gasEstimate = await provider.estimateGas({
        to: transaction.to,
        from: transaction.from,
        data: transaction.data,
        value: transaction.value,
      });
      return {
        success: true,
        gasEstimate: gasEstimate.toString(),
      };
    } catch (error) {
      logger.error({ error }, 'Uniswap V4 simulation failed');
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

    if (!this.supportsChain(chain)) {
      errors.push(`Uniswap V4 does not support chain: ${chain}`);
    }
    if (!config.sourceToken.address || config.sourceToken.address.length !== 42) {
      errors.push('Invalid source token address');
    }
    if (!config.destinationToken.address || config.destinationToken.address.length !== 42) {
      errors.push('Invalid destination token address');
    }
    if (!config.amount || BigInt(config.amount) <= BigInt(0)) {
      errors.push('Invalid swap amount');
    }
    if (config.slippageTolerance !== undefined) {
      if (config.slippageTolerance < 0 || config.slippageTolerance > 50) {
        errors.push('Slippage tolerance must be between 0 and 50');
      }
    }
    if (!config.walletAddress || config.walletAddress.length !== 42) {
      errors.push('Invalid wallet address');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private buildPoolKey(
    token0: string,
    token1: string
  ): { poolKey: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }; zeroForOne: boolean } {
    const [addr0, addr1] =
      token0.toLowerCase() < token1.toLowerCase()
        ? [token0, token1]
        : [token1, token0];
    return {
      poolKey: {
        currency0: addr0,
        currency1: addr1,
        fee: 0, // Filled per fee tier
        tickSpacing: 0,
        hooks: HOOKS_ZERO,
      },
      zeroForOne: token0.toLowerCase() === addr0.toLowerCase(),
    };
  }

  private async tryMultipleFees(
    quoter: Contract,
    config: SwapInputConfig,
    basePoolKey: { currency0: string; currency1: string; hooks: string },
    zeroForOne: boolean
  ): Promise<any[]> {
    const results: any[] = [];

    for (const { fee, tickSpacing } of FEE_TIERS) {
      try {
        const poolKey = {
          ...basePoolKey,
          fee,
          tickSpacing,
        };

        if (config.swapType === SwapType.EXACT_INPUT) {
          const [amountOut, gasEstimate] = await quoter.quoteExactInputSingle.staticCall({
            poolKey,
            zeroForOne,
            exactAmount: config.amount,
            hookData: HOOK_DATA,
          });
          const slippage = config.slippageTolerance || 0.5;
          const slippageMultiplier = 1 - slippage / 100;
          results.push({
            fee,
            tickSpacing,
            amountIn: config.amount,
            amountOut: amountOut.toString(),
            estimatedAmountOut: (
              (BigInt(amountOut) * BigInt(Math.floor(slippageMultiplier * 10000))) /
              BigInt(10000)
            ).toString(),
            gasEstimate: gasEstimate.toString(),
          });
        } else {
          const [amountIn, gasEstimate] = await quoter.quoteExactOutputSingle.staticCall({
            poolKey,
            zeroForOne,
            exactAmount: config.amount,
            hookData: HOOK_DATA,
          });
          results.push({
            fee,
            tickSpacing,
            amountIn: amountIn.toString(),
            amountOut: config.amount,
            estimatedAmountOut: config.amount,
            gasEstimate: gasEstimate.toString(),
          });
        }
      } catch (err) {
        logger.debug({ fee, error: (err as Error).message }, 'V4 quote failed for fee tier');
      }
    }
    return results;
  }

  private selectBestQuote(results: any[], swapType: SwapType): any {
    if (results.length === 0) throw new Error('No valid quotes found');
    if (swapType === SwapType.EXACT_INPUT) {
      return results.reduce((best, cur) =>
        BigInt(cur.amountOut) > BigInt(best.amountOut) ? cur : best
      );
    }
    return results.reduce((best, cur) =>
      BigInt(cur.amountIn) < BigInt(best.amountIn) ? cur : best
    );
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
      return { address, decimals: Number(decimals), symbol, name };
    } catch {
      return { address };
    }
  }

  private calculatePriceImpact(amountIn: string, amountOut: string): string {
    try {
      const impact = (BigInt(amountIn) * BigInt(100)) / BigInt(amountOut);
      return (Number(impact) / 100).toFixed(2);
    } catch {
      return '0';
    }
  }
}
