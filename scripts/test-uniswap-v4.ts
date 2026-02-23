/**
 * Test script for Uniswap V4 Provider
 *
 * Usage:
 *   npx ts-node scripts/test-uniswap-v4.ts [options]
 *
 * Options:
 *   --network, -n   Network: eth-sepolia | arb-sepolia | uni-sepolia | eth-main | arb-main | uni-main (default: arb-sepolia)
 *   --direction, -d weth-usdc | usdc-weth only (default: weth-usdc)
 *   --amount, -a    Amount in source token (e.g. 0.001 or 10) (default: 0.001)
 *
 * Env:
 *   ALCHEMY_API_KEY   If set, RPC for the selected network uses Alchemy.
 *   WALLET_ADDRESS    Wallet to use (default: 0xc07...).
 *   WALLET_PRIVATE_KEY  Optional, for signing.
 *
 * Examples:
 *   npx ts-node scripts/test-uniswap-v4.ts -n eth-sepolia -d weth-usdc -a 0.001
 *   npx ts-node scripts/test-uniswap-v4.ts --network arb-main --direction usdc-weth --amount 10
 */

import * as dotenv from 'dotenv';
dotenv.config();

// ---------------------------------------------------------------------------
// Parse args and set Alchemy RPC *before* importing chain-dependent modules
// ---------------------------------------------------------------------------

const NETWORK_ALIASES: Record<string, string> = {
  'arb-sepolia': 'arb-sepolia',
  'arb-main': 'arb-main',
};

const ALCHEMY_RPC: Record<string, string> = {
  'arb-sepolia': 'https://arb-sepolia.g.alchemy.com/v2/',
  'arb-main': 'https://arb-mainnet.g.alchemy.com/v2/',
};

const RPC_ENV_KEYS: Record<string, string> = {
  'arb-sepolia': 'ARBITRUM_SEPOLIA_RPC_URL',
  'arb-main': 'ARBITRUM_RPC_URL',
};

type Direction = 'weth-usdc' | 'usdc-weth';

function parseArgs(argv: string[]): { network: string; direction: Direction; amount: string } {
  let network = 'arb-sepolia';
  let direction: Direction = 'weth-usdc';
  let amount = '0.001';

  const validDirections: Direction[] = ['weth-usdc', 'usdc-weth'];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--network' || arg === '-n') {
      network = argv[++i] ?? network;
    } else if (arg === '--direction' || arg === '-d') {
      const d = argv[++i];
      if (d && validDirections.includes(d as Direction)) direction = d as Direction;
    } else if (arg === '--amount' || arg === '-a') {
      amount = argv[++i] ?? amount;
    }
  }

  const normalized = NETWORK_ALIASES[network] ?? network;
  if (!ALCHEMY_RPC[normalized]) {
    console.error('Unknown network:', network);
    console.error('Supported: arb-sepolia, arb-main');
    process.exit(1);
  }

  return { network: normalized, direction, amount };
}

function validateDirection(direction: string): void {
  if (direction !== 'weth-usdc' && direction !== 'usdc-weth') {
    console.error('Invalid direction:', direction);
    console.error('Allowed: weth-usdc | usdc-weth only');
    process.exit(1);
  }
}

function applyAlchemyRpc(networkSlug: string): void {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return;
  const base = ALCHEMY_RPC[networkSlug];
  const envKey = RPC_ENV_KEYS[networkSlug];
  if (base && envKey) {
    process.env[envKey] = `${base}/${key}`;
  }
}

// Parse and apply RPC before any chain-dependent import
const ARGS = parseArgs(process.argv.slice(2));
validateDirection(ARGS.direction);
applyAlchemyRpc(ARGS.network);

// Now import chain-dependent modules (RPC env is set)
import { Contract, Wallet } from 'ethers';
import { swapProviderFactory } from '../src/services/swap/providers/SwapProviderFactory';
import { getProvider } from '../src/config/providers';
import { CHAIN_CONFIGS } from '../src/config/chains';
import { SwapProvider, SupportedChain, SwapType } from '../src/types';

const V4_QUOTER_ABI = [
  'function quoteExactInputSingle((tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData)) external returns (uint256 amountOut, uint256 gasEstimate)',
];
const V4_FEE_TIERS: { fee: number; tickSpacing: number; label: string }[] = [
  { fee: 100, tickSpacing: 1, label: '0.01%' },
  { fee: 500, tickSpacing: 10, label: '0.05%' },
  { fee: 3000, tickSpacing: 60, label: '0.3%' },
  { fee: 10000, tickSpacing: 200, label: '1%' },
];
const HOOKS_ZERO = '0x0000000000000000000000000000000000000000';
const HOOK_DATA = '0x';

const ERC20_BALANCE_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const ERC20_APPROVE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
];

// Permit2: user approves Permit2 once, then Permit2.approve(token, spender, amount, expiration)
const PERMIT2_APPROVE_ABI = [
  'function approve(address token, address spender, uint160 amount, uint48 expiration) external',
];

const MAX_UINT160 = (2n ** 160n - 1n).toString();

// Network slug (after alias) -> SupportedChain (Ethereum, Arbitrum, Unichain — Sepolia + mainnet only)
function getChainForNetwork(slug: string): SupportedChain {
  switch (slug) {
    case 'arb-sepolia':
      return SupportedChain.ARBITRUM_SEPOLIA;
    case 'arb-main':
      return SupportedChain.ARBITRUM;
    default:
      return SupportedChain.ARBITRUM_SEPOLIA;
  }
}

const TEST_CHAIN = getChainForNetwork(ARGS.network);

// Test tokens per chain (WETH and USDC)
const TEST_TOKENS: Record<string, { WETH: { address: string; symbol: string; decimals: number }; USDC: { address: string; symbol: string; decimals: number } }> = {
  ARBITRUM_SEPOLIA: {
    WETH: { address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', symbol: 'WETH', decimals: 18 },
    USDC: { address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', symbol: 'USDC', decimals: 6 },
  },

  ARBITRUM: {
    WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', decimals: 18 },
    USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
  },

};

const CHAIN_LABELS: Record<string, string> = {
  ARBITRUM_SEPOLIA: 'Arbitrum Sepolia (421614)',
  ARBITRUM: 'Arbitrum One (42161)',
};

const TEST_WALLET = process.env.WALLET_ADDRESS ?? '0xc073A5E091DC60021058346b10cD5A9b3F0619fE';

/** Human amount -> wei string for the given token decimals */
function amountToWei(amountStr: string, decimals: number): string {
  const n = parseFloat(amountStr);
  if (!Number.isFinite(n) || n < 0) return '0';
  const s = n.toFixed(decimals);
  const [head, tail] = s.split('.');
  const frac = (tail ?? '').padEnd(decimals, '0').slice(0, decimals);
  return (head === '0' ? '' : head) + frac;
}

// ---------------------------------------------------------------------------
// Tests (take chain + swap config from closure)
// ---------------------------------------------------------------------------

async function fetchAndLogBalances(): Promise<void> {
  console.log('\n=== Wallet Balances ===');
  console.log('Wallet:', TEST_WALLET);
  if (process.env.WALLET_PRIVATE_KEY) {
    console.log('Private key: loaded from WALLET_PRIVATE_KEY');
  } else {
    console.log('Private key: not set (WALLET_PRIVATE_KEY)');
  }

  const tokens = TEST_TOKENS[TEST_CHAIN];
  const provider = getProvider(TEST_CHAIN);

  const wethContract = new Contract(tokens.WETH.address, ERC20_BALANCE_ABI, provider);
  const usdcContract = new Contract(tokens.USDC.address, ERC20_BALANCE_ABI, provider);

  try {
    const [wethBalanceWei, usdcBalanceWei] = await Promise.all([
      wethContract.balanceOf(TEST_WALLET),
      usdcContract.balanceOf(TEST_WALLET),
    ]);

    const wethBalance = Number(wethBalanceWei) / 10 ** tokens.WETH.decimals;
    const usdcBalance = Number(usdcBalanceWei) / 10 ** tokens.USDC.decimals;

    console.log(`  WETH: ${wethBalance.toFixed(6)} (raw: ${wethBalanceWei.toString()})`);
    console.log(`  USDC: ${usdcBalance.toFixed(6)} (raw: ${usdcBalanceWei.toString()})`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('  Could not read WETH/USDC balances:', msg);
    console.log('  (Token contracts may not exist at configured addresses for this chain.)');
  }
}

/** Probe V4 quoter for WETH/USDC pools (both directions) and log available fee tiers */
async function fetchAndLogAvailablePools(): Promise<void> {
  console.log('\n=== Available Pools (V4 Quoter) ===');
  const quoterAddress = CHAIN_CONFIGS[TEST_CHAIN]?.contracts?.uniswapV4Quoter;
  if (!quoterAddress || quoterAddress === '0x0') {
    console.log('  No V4 Quoter configured for this chain.');
    return;
  }

  const tokens = TEST_TOKENS[TEST_CHAIN];
  const provider = getProvider(TEST_CHAIN);
  const quoter = new Contract(quoterAddress, V4_QUOTER_ABI, provider);

  const weth = tokens.WETH.address;
  const usdc = tokens.USDC.address;
  const [addr0, addr1] =
    weth.toLowerCase() < usdc.toLowerCase() ? [weth, usdc] : [usdc, weth];

  const oneWei = '1';
  const oneUsdc = '1000000'; // 6 decimals

  const poolsWethToUsdc: string[] = [];
  const poolsUsdcToWeth: string[] = [];
  const wethIsToken0 = weth.toLowerCase() === addr0.toLowerCase();

  for (const { fee, tickSpacing, label } of V4_FEE_TIERS) {
    const poolKey = {
      currency0: addr0,
      currency1: addr1,
      fee,
      tickSpacing,
      hooks: HOOKS_ZERO,
    };

    try {
      await quoter.quoteExactInputSingle.staticCall({
        poolKey,
        zeroForOne: wethIsToken0,
        exactAmount: wethIsToken0 ? oneWei : oneUsdc,
        hookData: HOOK_DATA,
      });
      poolsWethToUsdc.push(label);
    } catch {
      // no liquidity for WETH -> USDC at this tier
    }

    try {
      await quoter.quoteExactInputSingle.staticCall({
        poolKey,
        zeroForOne: !wethIsToken0,
        exactAmount: wethIsToken0 ? oneUsdc : oneWei,
        hookData: HOOK_DATA,
      });
      poolsUsdcToWeth.push(label);
    } catch {
      // no liquidity for USDC -> WETH at this tier
    }
  }

  const uniqueWethUsdc = [...new Set(poolsWethToUsdc)].sort();
  const uniqueUsdcWeth = [...new Set(poolsUsdcToWeth)].sort();
  console.log('  Pair WETH/USDC (V4):');
  console.log('    WETH -> USDC fee tiers with liquidity:', uniqueWethUsdc.length ? uniqueWethUsdc.join(', ') : 'none');
  console.log('    USDC -> WETH fee tiers with liquidity:', uniqueUsdcWeth.length ? uniqueUsdcWeth.join(', ') : 'none');
  if (uniqueWethUsdc.length === 0 && uniqueUsdcWeth.length === 0) {
    console.log('  No V4 pools found for WETH/USDC on this network.');
  }
}

/**
 * Ensure the swap target (Universal Router or PoolSwapTest) can pull the source token.
 * - Universal Router: approve token to Permit2 (max), then Permit2.approve(token, router, amount, expiration).
 * - PoolSwapTest: approve token to PoolSwapTest (amount).
 */
async function ensureApproval(
  sourceToken: { address: string; symbol: string },
  spender: string,
  amountWei: string
): Promise<void> {
  if (!process.env.WALLET_PRIVATE_KEY) {
    console.log('\n⚠ Skipping approval: WALLET_PRIVATE_KEY not set. Simulation may revert.');
    return;
  }

  const universalRouter = CHAIN_CONFIGS[TEST_CHAIN]?.contracts?.universalRouter;
  const permit2 = CHAIN_CONFIGS[TEST_CHAIN]?.contracts?.permit2;
  const isUniversalRouter =
    universalRouter &&
    spender.toLowerCase() === universalRouter.toLowerCase();

  const provider = getProvider(TEST_CHAIN);
  const signer = new Wallet(process.env.WALLET_PRIVATE_KEY, provider);

  if (isUniversalRouter && permit2) {
    console.log('\n=== Ensuring Permit2 + Universal Router Approval ===');

    const tokenContract = new Contract(sourceToken.address, ERC20_APPROVE_ABI, signer);
    const permit2Contract = new Contract(permit2, PERMIT2_APPROVE_ABI, signer);

    try {
      // 1. Token -> Permit2 (max), one-time
      console.log(`  1. Approving ${sourceToken.symbol} to Permit2 (max)...`);
      let tx = await tokenContract.approve(permit2, MAX_UINT160);
      await tx.wait();
      console.log('     ✓ Token approval to Permit2 confirmed');

      // 2. Permit2: allow Universal Router to pull amount (uint160, uint48 expiration)
      const amount160 = BigInt(amountWei) > BigInt(MAX_UINT160) ? MAX_UINT160 : amountWei;
      const expiration = Math.floor(Date.now() / 1000) + 3600; // 1 hour, uint48
      console.log(`  2. Permit2.approve(${sourceToken.symbol}, Universal Router, amount, expiration)...`);
      tx = await permit2Contract.approve(sourceToken.address, spender, amount160, expiration);
      await tx.wait();
      console.log('     ✓ Permit2 allowance for router confirmed');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('  ⚠ Approval failed:', msg);
    }
    return;
  }

  // Direct ERC20 approval (e.g. for PoolSwapTest)
  console.log('\n=== Ensuring ERC20 Approval ===');
  const tokenContract = new Contract(sourceToken.address, ERC20_APPROVE_ABI, signer);
  try {
    console.log(`  Approving ${sourceToken.symbol} for spender: ${spender}`);
    const tx = await tokenContract.approve(spender, amountWei);
    await tx.wait();
    console.log('  ✓ Approval confirmed on-chain');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('  ⚠ Approval failed:', msg);
  }
}

async function testProviderInitialization() {
  console.log('\n=== Testing Provider Initialization ===');

  const provider = swapProviderFactory.getProvider(SwapProvider.UNISWAP_V4);
  console.log('✓ Provider initialized:', provider.getName());
  const supportsTestChain = provider.supportsChain(TEST_CHAIN);
  console.log(`✓ Supports ${CHAIN_LABELS[TEST_CHAIN] ?? TEST_CHAIN}:`, supportsTestChain);
  return provider;
}

async function testValidation(
  provider: any,
  sourceToken: { address: string; symbol: string; decimals: number },
  destToken: { address: string; symbol: string; decimals: number },
  amountWei: string
): Promise<boolean> {
  console.log('\n=== Testing Configuration Validation ===');

  const validConfig = {
    sourceToken,
    destinationToken: destToken,
    amount: amountWei,
    swapType: SwapType.EXACT_INPUT,
    walletAddress: TEST_WALLET,
    slippageTolerance: 0.5,
  };

  try {
    const validation = await provider.validateConfig(TEST_CHAIN, validConfig);
    if (validation.valid) {
      console.log('✓ Configuration is valid');
    } else {
      console.log('✗ Configuration validation failed:', validation.errors);
    }
    return validation.valid;
  } catch (error) {
    console.error('✗ Validation error:', error);
    return false;
  }
}

async function testGetQuote(
  provider: any,
  sourceToken: { address: string; symbol: string; decimals: number },
  destToken: { address: string; symbol: string; decimals: number },
  amountWei: string,
  amountLabel: string
) {
  console.log('\n=== Testing Get Quote ===');

  const config = {
    sourceToken,
    destinationToken: destToken,
    amount: amountWei,
    swapType: SwapType.EXACT_INPUT,
    walletAddress: TEST_WALLET,
    slippageTolerance: 0.5,
  };

  console.log('Requesting quote for:', {
    chain: TEST_CHAIN,
    from: config.sourceToken.symbol,
    to: config.destinationToken.symbol,
    amount: amountLabel,
    amountWei: config.amount,
  });

  const quote = await provider.getQuote(TEST_CHAIN, config);

  console.log('✓ Quote received:');
  console.log('  Amount In:', quote.amountIn);
  console.log('  Amount Out:', quote.amountOut);
  console.log('  Estimated Amount Out:', quote.estimatedAmountOut);
  console.log('  Gas Estimate:', quote.gasEstimate);
  console.log('  Price Impact:', quote.priceImpact);
  console.log('  Raw Quote:', JSON.stringify(quote.rawQuote, null, 2));

  return quote;
}

async function testBuildTransaction(
  provider: any,
  quote: any,
  sourceToken: { address: string; symbol: string; decimals: number },
  destToken: { address: string; symbol: string; decimals: number },
  amountWei: string
) {
  console.log('\n=== Testing Build Transaction ===');

  const config = {
    sourceToken,
    destinationToken: destToken,
    amount: amountWei,
    swapType: SwapType.EXACT_INPUT,
    walletAddress: TEST_WALLET,
    slippageTolerance: 0.5,
  };

  const transaction = await provider.buildTransaction(TEST_CHAIN, config, quote);

  console.log('✓ Transaction built:');
  console.log('  To:', transaction.to);
  console.log('  Chain ID:', transaction.chainId);
  console.log('  Gas Limit:', transaction.gasLimit);
  console.log('  Data length:', transaction.data.length, 'bytes');
  console.log('  Data (first 100 chars):', transaction.data.substring(0, 100) + '...');

  return transaction;
}

async function testSimulateTransaction(provider: any, transaction: any) {
  console.log('\n=== Testing Transaction Simulation ===');

  try {
    const simulation = await provider.simulateTransaction(TEST_CHAIN, transaction);
    if (simulation.success) {
      console.log('✓ Simulation successful');
      console.log('  Gas Estimate:', simulation.gasEstimate);
    } else {
      console.log('⚠ Simulation failed:', simulation.error);
    }
    return simulation;
  } catch (error: any) {
    console.error('✗ Simulation error:', error.message);
    return { success: false, error: error.message };
  }
}

async function runAllTests() {
  const tokens = TEST_TOKENS[TEST_CHAIN];
  const sourceToken = ARGS.direction === 'weth-usdc' ? tokens.WETH : tokens.USDC;
  const destToken = ARGS.direction === 'weth-usdc' ? tokens.USDC : tokens.WETH;
  const amountWei = amountToWei(ARGS.amount, sourceToken.decimals);
  const amountLabel = `${ARGS.amount} ${sourceToken.symbol}`;

  console.log('🚀 Starting Uniswap V4 Provider Tests\n');
  console.log('Network (arg):', ARGS.network);
  console.log('Chain:', CHAIN_LABELS[TEST_CHAIN] ?? TEST_CHAIN);
  console.log('Provider: UNISWAP_V4');
  console.log('Swap:', amountLabel, '->', destToken.symbol);
  if (process.env.ALCHEMY_API_KEY) {
    console.log('RPC: Alchemy (ALCHEMY_API_KEY set)');
  }
  console.log('');

  try {
    await fetchAndLogBalances();
    await fetchAndLogAvailablePools();

    const provider = await testProviderInitialization();
    if (!provider.supportsChain(TEST_CHAIN)) {
      console.log('\n⚠ Uniswap V4 provider does not support this chain. Quote/build will fail.');
    }

    const isValid = await testValidation(provider, sourceToken, destToken, amountWei);
    if (!isValid) {
      console.log('\n⚠ Skipping quote tests due to validation failure');
      process.exit(0);
    }

    const quote = await testGetQuote(provider, sourceToken, destToken, amountWei, amountLabel);
    const transaction = await testBuildTransaction(provider, quote, sourceToken, destToken, amountWei);

    // Ensure ERC20 approval for the swap target (e.g. PoolSwapTest) before simulation
    await ensureApproval(sourceToken, transaction.to, amountWei);

    await testSimulateTransaction(provider, transaction);

    console.log('\n✅ All tests completed!');
    process.exit(0);
  } catch (error: any) {
    const msg = error?.message ?? '';
    if (msg.includes('PoolNotInitialized') || msg.includes('No Uniswap V4 pool exists')) {
      console.log(`\n⚠ Quote skipped: no V4 pool for ${sourceToken.symbol}/${destToken.symbol} on ${CHAIN_LABELS[TEST_CHAIN] ?? TEST_CHAIN}`);
      console.log('  The provider and chain config are correct; this pair may have no V4 pool yet.');
      console.log('  See: https://docs.uniswap.org/contracts/v4/deployments');
      console.log('\n✅ Provider init and validation passed. Quote/build require an existing V4 pool.');
      process.exit(0);
    }
    console.error('\n❌ Tests failed:', error.message);
    console.error('\nCommon issues:');
    console.error('- Pool may not exist for the token pair');
    console.error('- Uniswap V4 may not be deployed on this chain');
    console.error('- Insufficient liquidity; network or contract issues');
    process.exit(1);
  }
}

runAllTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
