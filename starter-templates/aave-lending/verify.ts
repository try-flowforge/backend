/**
 * Verification script for the Aave Lending CRE template.
 *
 * Tests config validation, chain registry resolution, deep merge,
 * and report encoding — everything except the CRE SDK runtime.
 *
 * Run from the backend root:
 *   npx ts-node starter-templates/aave-lending/verify.ts
 */

import { z } from 'zod';
import {
  type Address,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import * as fs from 'fs';
import * as path from 'path';

// ── Replicate schemas from main.ts ──────────────────────────────────────

const tokenInfoSchema = z.object({
  address: z.string(),
  symbol: z.string().optional(),
  decimals: z.number().optional(),
  aTokenAddress: z.string().optional(),
});

const inputConfigSchema = z.object({
  operation: z.enum([
    'SUPPLY', 'WITHDRAW', 'BORROW', 'REPAY',
    'ENABLE_COLLATERAL', 'DISABLE_COLLATERAL',
  ]),
  asset: tokenInfoSchema,
  amount: z.string(),
  walletAddress: z.string(),
  interestRateMode: z.enum(['STABLE', 'VARIABLE']).optional(),
  onBehalfOf: z.string().optional(),
  referralCode: z.number().optional(),
});

const configSchema = z.object({
  chain: z.string(),
  chainSelectorName: z.string().optional(),
  provider: z.literal('AAVE'),
  aaveReceiverAddress: z.string(),
  poolAddress: z.string().optional(),
  gasLimit: z.string(),
  inputConfig: inputConfigSchema,
  simulateFirst: z.boolean().optional(),
});

type Config = z.infer<typeof configSchema>;

// ── Replicate chain registry from main.ts ───────────────────────────────

interface ChainInfo {
  poolAddress: string;
  chainSelectorName: string;
  isTestnet: boolean;
}

const CHAIN_REGISTRY: Record<string, ChainInfo> = {
  ARBITRUM_SEPOLIA: {
    poolAddress: '0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff',
    chainSelectorName: 'ethereum-testnet-sepolia-arbitrum-1',
    isTestnet: true,
  },
  ETHEREUM_SEPOLIA: {
    poolAddress: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
    chainSelectorName: 'ethereum-testnet-sepolia-1',
    isTestnet: true,
  },
  ARBITRUM: {
    poolAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    chainSelectorName: 'ethereum-mainnet-arbitrum-1',
    isTestnet: false,
  },
  ETHEREUM: {
    poolAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    chainSelectorName: 'ethereum-mainnet-1',
    isTestnet: false,
  },
};

// ── Replicate helpers from main.ts ──────────────────────────────────────

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  overrides: Record<string, unknown>,
): T {
  const result = { ...base };
  for (const key of Object.keys(overrides)) {
    const val = overrides[key];
    if (val === undefined || val === null || val === '') continue;
    if (
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof (base as Record<string, unknown>)[key] === 'object' &&
      !Array.isArray((base as Record<string, unknown>)[key])
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        (base as Record<string, unknown>)[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

function resolveChainDefaults(config: Config): {
  poolAddress: string;
  chainSelectorName: string;
  isTestnet: boolean;
} {
  const info = CHAIN_REGISTRY[config.chain];
  const poolAddress = config.poolAddress || info?.poolAddress;
  if (!poolAddress) throw new Error(`No poolAddress for chain "${config.chain}"`);
  const chainSelectorName = config.chainSelectorName || info?.chainSelectorName;
  if (!chainSelectorName) throw new Error(`No chainSelectorName for chain "${config.chain}"`);
  const isTestnet = info?.isTestnet ?? config.chain.toLowerCase().includes('sepolia');
  return { poolAddress, chainSelectorName, isTestnet };
}

function encodeLendingReport(params: {
  operation: number;
  poolAddress: string;
  asset: string;
  amount: string;
  walletAddress: string;
  onBehalfOf: string;
  interestRateMode: number;
  referralCode: number;
  aTokenAddress: string;
}): string {
  return encodeAbiParameters(
    parseAbiParameters(
      'uint8 operation, address poolAddress, address asset, uint256 amount, address walletAddress, address onBehalfOf, uint256 interestRateMode, uint16 referralCode, address aTokenAddress',
    ),
    [
      params.operation,
      params.poolAddress as Address,
      params.asset as Address,
      BigInt(params.amount),
      params.walletAddress as Address,
      params.onBehalfOf as Address,
      BigInt(params.interestRateMode),
      params.referralCode,
      params.aTokenAddress as Address,
    ],
  );
}

// ── Test runner ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${(err as Error).message}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ── Tests ───────────────────────────────────────────────────────────────

console.log('\n=== Aave Lending CRE Template — Verification ===\n');

// 1. Config file validation
console.log('1. Config file validation');

const workflowDir = path.join(__dirname, 'aave-lending-ts', 'workflow');

test('config.staging.json parses and validates', () => {
  const raw = fs.readFileSync(path.join(workflowDir, 'config.staging.json'), 'utf-8');
  const parsed = JSON.parse(raw);
  const result = configSchema.safeParse(parsed);
  assert(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
});

test('config.production.json parses and validates', () => {
  const raw = fs.readFileSync(path.join(workflowDir, 'config.production.json'), 'utf-8');
  const parsed = JSON.parse(raw);
  const result = configSchema.safeParse(parsed);
  assert(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
});

test('staging config defaults to testnet chain', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(workflowDir, 'config.staging.json'), 'utf-8'));
  assert(raw.chain === 'ARBITRUM_SEPOLIA', `Expected ARBITRUM_SEPOLIA, got ${raw.chain}`);
});

test('production config defaults to mainnet chain', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(workflowDir, 'config.production.json'), 'utf-8'));
  assert(raw.chain === 'ARBITRUM', `Expected ARBITRUM, got ${raw.chain}`);
});

// 2. Chain registry resolution
console.log('\n2. Chain registry resolution');

test('ARBITRUM_SEPOLIA resolves to testnet with correct pool', () => {
  const config: Config = {
    chain: 'ARBITRUM_SEPOLIA', provider: 'AAVE', aaveReceiverAddress: '0x1234',
    gasLimit: '500000', inputConfig: {
      operation: 'SUPPLY', asset: { address: '0xabc' }, amount: '1000',
      walletAddress: '0xdef',
    },
  };
  const resolved = resolveChainDefaults(config);
  assert(resolved.isTestnet === true, 'Expected isTestnet=true');
  assert(resolved.poolAddress === '0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff', 'Wrong pool');
  assert(resolved.chainSelectorName === 'ethereum-testnet-sepolia-arbitrum-1', 'Wrong selector');
});

test('ARBITRUM resolves to mainnet with correct pool', () => {
  const config: Config = {
    chain: 'ARBITRUM', provider: 'AAVE', aaveReceiverAddress: '0x1234',
    gasLimit: '500000', inputConfig: {
      operation: 'SUPPLY', asset: { address: '0xabc' }, amount: '1000',
      walletAddress: '0xdef',
    },
  };
  const resolved = resolveChainDefaults(config);
  assert(resolved.isTestnet === false, 'Expected isTestnet=false');
  assert(resolved.poolAddress === '0x794a61358D6845594F94dc1DB02A252b5b4814aD', 'Wrong pool');
  assert(resolved.chainSelectorName === 'ethereum-mainnet-arbitrum-1', 'Wrong selector');
});

test('Explicit poolAddress overrides registry', () => {
  const config: Config = {
    chain: 'ARBITRUM_SEPOLIA', provider: 'AAVE', aaveReceiverAddress: '0x1234',
    poolAddress: '0xCustomPool',
    gasLimit: '500000', inputConfig: {
      operation: 'SUPPLY', asset: { address: '0xabc' }, amount: '1000',
      walletAddress: '0xdef',
    },
  };
  const resolved = resolveChainDefaults(config);
  assert(resolved.poolAddress === '0xCustomPool', 'Should use explicit poolAddress');
});

test('Unknown chain without explicit pool throws', () => {
  const config: Config = {
    chain: 'UNKNOWN_CHAIN', provider: 'AAVE', aaveReceiverAddress: '0x1234',
    gasLimit: '500000', inputConfig: {
      operation: 'SUPPLY', asset: { address: '0xabc' }, amount: '1000',
      walletAddress: '0xdef',
    },
  };
  let threw = false;
  try { resolveChainDefaults(config); } catch { threw = true; }
  assert(threw, 'Should throw for unknown chain without explicit pool');
});

// 3. Deep merge (HTTP payload overrides)
console.log('\n3. Deep merge (HTTP payload overrides)');

test('Blank payload returns file config unchanged', () => {
  const base = { chain: 'ARBITRUM_SEPOLIA', gasLimit: '500000', inputConfig: { operation: 'SUPPLY', amount: '1000' } };
  const merged = deepMerge(base as any, {});
  assert(merged.chain === 'ARBITRUM_SEPOLIA', 'chain should be unchanged');
  assert((merged as any).inputConfig.operation === 'SUPPLY', 'operation should be unchanged');
});

test('Partial payload overrides only specified fields', () => {
  const base = {
    chain: 'ARBITRUM_SEPOLIA', gasLimit: '500000',
    inputConfig: { operation: 'SUPPLY', amount: '1000', walletAddress: '0xOld' },
  };
  const overrides = { inputConfig: { operation: 'BORROW', amount: '5000' } };
  const merged = deepMerge(base as any, overrides as any);
  assert((merged as any).inputConfig.operation === 'BORROW', 'operation should be overridden');
  assert((merged as any).inputConfig.amount === '5000', 'amount should be overridden');
  assert((merged as any).inputConfig.walletAddress === '0xOld', 'walletAddress should be preserved');
  assert(merged.chain === 'ARBITRUM_SEPOLIA', 'chain should be preserved');
});

test('Chain override switches testnet to mainnet', () => {
  const base = { chain: 'ARBITRUM_SEPOLIA', gasLimit: '500000', inputConfig: { operation: 'SUPPLY' } };
  const overrides = { chain: 'ARBITRUM' };
  const merged = deepMerge(base as any, overrides as any);
  assert(merged.chain === 'ARBITRUM', 'chain should be overridden to ARBITRUM');
});

test('Empty string values in overrides are ignored', () => {
  const base = { chain: 'ARBITRUM_SEPOLIA', aaveReceiverAddress: '0xExisting' };
  const overrides = { aaveReceiverAddress: '' };
  const merged = deepMerge(base as any, overrides as any);
  assert(merged.aaveReceiverAddress === '0xExisting', 'empty string should not override');
});

// 4. Report encoding
console.log('\n4. Report encoding (ABI parameters)');

test('encodeLendingReport produces valid hex', () => {
  const hex = encodeLendingReport({
    operation: 0,
    poolAddress: '0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff',
    asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    amount: '1000000',
    walletAddress: '0xc073A5E091DC60021058346b10cD5A9b3F0619fE',
    onBehalfOf: '0xc073A5E091DC60021058346b10cD5A9b3F0619fE',
    interestRateMode: 2,
    referralCode: 0,
    aTokenAddress: '0x0000000000000000000000000000000000000000',
  });
  assert(hex.startsWith('0x'), 'Should start with 0x');
  assert(hex.length > 10, 'Should have substantial encoded data');
});

test('Different operations produce different payloads', () => {
  const makeReport = (op: number) => encodeLendingReport({
    operation: op,
    poolAddress: '0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff',
    asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    amount: '1000000',
    walletAddress: '0xc073A5E091DC60021058346b10cD5A9b3F0619fE',
    onBehalfOf: '0xc073A5E091DC60021058346b10cD5A9b3F0619fE',
    interestRateMode: 2,
    referralCode: 0,
    aTokenAddress: '0x0000000000000000000000000000000000000000',
  });
  const supply = makeReport(0);
  const withdraw = makeReport(1);
  const borrow = makeReport(2);
  const repay = makeReport(3);
  assert(supply !== withdraw, 'SUPPLY and WITHDRAW should differ');
  assert(borrow !== repay, 'BORROW and REPAY should differ');
});

// 5. Operation validation
console.log('\n5. Operation type validation');

for (const op of ['SUPPLY', 'WITHDRAW', 'BORROW', 'REPAY'] as const) {
  test(`${op} is accepted by schema`, () => {
    const config = {
      chain: 'ARBITRUM_SEPOLIA', provider: 'AAVE', aaveReceiverAddress: '0x1234',
      gasLimit: '500000',
      inputConfig: {
        operation: op, asset: { address: '0xabc' }, amount: '1000', walletAddress: '0xdef',
      },
    };
    const result = configSchema.safeParse(config);
    assert(result.success, `${op} should be valid`);
  });
}

test('Invalid operation is rejected by schema', () => {
  const config = {
    chain: 'ARBITRUM_SEPOLIA', provider: 'AAVE', aaveReceiverAddress: '0x1234',
    gasLimit: '500000',
    inputConfig: {
      operation: 'FLASH_LOAN', asset: { address: '0xabc' }, amount: '1000', walletAddress: '0xdef',
    },
  };
  const result = configSchema.safeParse(config);
  assert(!result.success, 'FLASH_LOAN should be rejected');
});

// 6. File structure
console.log('\n6. File structure');

const expectedFiles = [
  'aave-lending-ts/workflow/main.ts',
  'aave-lending-ts/workflow/workflow.yaml',
  'aave-lending-ts/workflow/config.staging.json',
  'aave-lending-ts/workflow/config.production.json',
  'aave-lending-ts/workflow/package.json',
  'aave-lending-ts/contracts/abi/IPool.ts',
  'aave-lending-ts/contracts/abi/index.ts',
  'contracts/src/AaveReceiver.sol',
  'contracts/src/keystone/IReceiver.sol',
  'contracts/src/keystone/IERC165.sol',
  'contracts/scripts/DeployAaveReceiver.s.sol',
  'contracts/foundry.toml',
  'contracts/remappings.txt',
  'README.md',
];

for (const file of expectedFiles) {
  test(`${file} exists`, () => {
    const fullPath = path.join(__dirname, file);
    assert(fs.existsSync(fullPath), `Missing: ${fullPath}`);
  });
}

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
