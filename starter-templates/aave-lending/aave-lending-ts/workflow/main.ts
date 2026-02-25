/**
 * Aave lending CRE workflow (TypeScript).
 *
 * Config shape aligned with agentic LendingNodeConfig / LendingInputConfig
 * so it can be invoked from FlowForge with the same config.
 *
 * Trigger:  HTTP only — immediate execution.
 *           The HTTP payload carries config overrides so the frontend / agent
 *           can pass operation, chain, asset, amount, etc. per invocation.
 *
 * Execution: CRE report → AaveReceiver contract → Aave V3 Pool.
 *
 * Environment mapping:
 *   staging-settings  → testnet chains  (e.g. ARBITRUM_SEPOLIA)
 *   production-settings → mainnet chains (e.g. ARBITRUM)
 *   The caller can override the chain in the HTTP payload; the workflow
 *   auto-resolves poolAddress and chainSelectorName from the chain registry.
 */

import {
  bytesToHex,
  cre,
  decodeJson,
  encodeCallMsg,
  getNetwork,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  Runner,
  type Runtime,
  type HTTPPayload,
  TxStatus,
} from '@chainlink/cre-sdk';
import {
  type Address,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
  zeroAddress,
} from 'viem';
import { z } from 'zod';
import { IPool } from '../contracts/abi';

// ---------------------------------------------------------------------------
// Chain registry — add new chains here; the workflow resolves everything else.
// When the frontend/agent sends { chain: "ARBITRUM_SEPOLIA" }, the workflow
// looks up poolAddress, chainSelectorName, and testnet flag automatically.
// ---------------------------------------------------------------------------

interface ChainInfo {
  poolAddress: string;
  chainSelectorName: string;
  isTestnet: boolean;
}

const CHAIN_REGISTRY: Record<string, ChainInfo> = {
  // ---- Testnets ----
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
  // ---- Mainnets ----
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

// ---------------------------------------------------------------------------
// Config schema (aligned with agentic LendingNodeConfig / LendingInputConfig)
// ---------------------------------------------------------------------------

const tokenInfoSchema = z.object({
  address: z.string(),
  symbol: z.string().optional(),
  decimals: z.number().optional(),
  aTokenAddress: z.string().optional(),
});

const inputConfigSchema = z.object({
  operation: z.enum([
    'SUPPLY',
    'WITHDRAW',
    'BORROW',
    'REPAY',
    'ENABLE_COLLATERAL',
    'DISABLE_COLLATERAL',
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OP_SUPPLY = 0;
const OP_WITHDRAW = 1;
const OP_BORROW = 2;
const OP_REPAY = 3;

const INTEREST_RATE_STABLE = 1;
const INTEREST_RATE_VARIABLE = 2;

// ---------------------------------------------------------------------------
// Result type (maps to NodeExecutionOutput / LendingExecutionResult)
// ---------------------------------------------------------------------------

export type LendingResult = {
  success: boolean;
  txHash?: string;
  operation: string;
  amount: string;
  chain: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// Deep merge utility — payload overrides file config at every nesting level
// ---------------------------------------------------------------------------

function deepMerge<T extends Record<string, unknown>>(base: T, overrides: Record<string, unknown>): T {
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

// ---------------------------------------------------------------------------
// Resolve chain defaults from the registry.
// If the caller only passes { chain: "ARBITRUM_SEPOLIA" }, we fill in
// poolAddress and chainSelectorName automatically.
// ---------------------------------------------------------------------------

function resolveChainDefaults(config: Config): {
  poolAddress: string;
  chainSelectorName: string;
  isTestnet: boolean;
} {
  const info = CHAIN_REGISTRY[config.chain];

  const poolAddress = config.poolAddress || info?.poolAddress;
  if (!poolAddress) {
    throw new Error(`No poolAddress configured and chain "${config.chain}" is not in the registry`);
  }

  const chainSelectorName = config.chainSelectorName || info?.chainSelectorName;
  if (!chainSelectorName) {
    throw new Error(
      `No chainSelectorName configured and chain "${config.chain}" is not in the registry`,
    );
  }

  const testnet = info?.isTestnet ?? config.chain.toLowerCase().includes('sepolia');

  return { poolAddress, chainSelectorName, isTestnet: testnet };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEvmClient(chainSelectorName: string, testnet: boolean) {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName,
    isTestnet: testnet,
  });
  if (!network) {
    throw new Error(`Network not found for chain selector: ${chainSelectorName}`);
  }
  return new cre.capabilities.EVMClient(network.chainSelector.selector);
}

function getInterestRateMode(mode?: string): number {
  if (mode === 'STABLE') return INTEREST_RATE_STABLE;
  return INTEREST_RATE_VARIABLE;
}

function getATokenAddress(
  runtime: Runtime,
  poolAddress: string,
  assetAddress: string,
  chainSelectorName: string,
  testnet: boolean,
): string {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName,
    isTestnet: testnet,
  });
  if (!network) {
    throw new Error(`Network not found for chain selector: ${chainSelectorName}`);
  }
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);

  const callData = encodeFunctionData({
    abi: IPool,
    functionName: 'getReserveData',
    args: [assetAddress as Address],
  });

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: poolAddress as Address,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const reserveData = decodeFunctionResult({
    abi: IPool,
    functionName: 'getReserveData',
    data: bytesToHex(contractCall.data),
  });

  const aTokenAddr = Array.isArray(reserveData)
    ? (reserveData[8] as Address)
    : (reserveData as { aTokenAddress: Address }).aTokenAddress;
  return aTokenAddr;
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

// ---------------------------------------------------------------------------
// Core lending logic — accepts an explicit config so the HTTP handler can
// merge file defaults with per-request payload overrides.
// ---------------------------------------------------------------------------

function doLending(runtime: Runtime, config: Config): string {
  const { operation, asset, amount, walletAddress } = config.inputConfig;

  if (!config.aaveReceiverAddress || config.aaveReceiverAddress === '') {
    return JSON.stringify({
      success: false,
      operation,
      amount,
      chain: config.chain,
      error: 'aaveReceiverAddress is required; deploy AaveReceiver and set in config',
    } satisfies LendingResult);
  }

  if (operation === 'ENABLE_COLLATERAL' || operation === 'DISABLE_COLLATERAL') {
    return JSON.stringify({
      success: false,
      operation,
      amount,
      chain: config.chain,
      error:
        'ENABLE_COLLATERAL and DISABLE_COLLATERAL must be called directly by the user; ' +
        'use Pool.setUserUseReserveAsCollateral(asset, useAsCollateral)',
    } satisfies LendingResult);
  }

  const opCode =
    operation === 'SUPPLY'
      ? OP_SUPPLY
      : operation === 'WITHDRAW'
        ? OP_WITHDRAW
        : operation === 'BORROW'
          ? OP_BORROW
          : OP_REPAY;

  let resolved: ReturnType<typeof resolveChainDefaults>;
  try {
    resolved = resolveChainDefaults(config);
  } catch (err: unknown) {
    return JSON.stringify({
      success: false,
      operation,
      amount,
      chain: config.chain,
      error: (err as Error).message,
    } satisfies LendingResult);
  }

  const { poolAddress, chainSelectorName, isTestnet: testnet } = resolved;
  const evmClient = getEvmClient(chainSelectorName, testnet);

  const assetAddress = asset.address;
  const onBehalfOf = config.inputConfig.onBehalfOf || walletAddress;
  const interestRateMode = getInterestRateMode(config.inputConfig.interestRateMode);
  const referralCode = config.inputConfig.referralCode ?? 0;

  let aTokenAddress = asset.aTokenAddress ?? '0x0000000000000000000000000000000000000000';
  if (operation === 'WITHDRAW') {
    if (!aTokenAddress || aTokenAddress === '0x0000000000000000000000000000000000000000') {
      aTokenAddress = getATokenAddress(
        runtime,
        poolAddress,
        assetAddress,
        chainSelectorName,
        testnet,
      );
    }
  }

  const reportPayloadHex = encodeLendingReport({
    operation: opCode,
    poolAddress,
    asset: assetAddress,
    amount,
    walletAddress,
    onBehalfOf,
    interestRateMode,
    referralCode,
    aTokenAddress,
  });

  runtime.log(
    `Aave ${operation} on ${config.chain}: asset=${assetAddress} amount=${amount} ` +
      `wallet=${walletAddress} onBehalfOf=${onBehalfOf}`,
  );

  const reportPayloadBytes = reportPayloadHex.startsWith('0x')
    ? reportPayloadHex
    : (`0x${reportPayloadHex}` as `0x${string}`);

  const reportResponse = runtime
    .report({
      encodedPayload: hexToBase64(reportPayloadBytes),
      encoderName: 'evm',
      signingAlgo: 'ecdsa',
      hashingAlgo: 'keccak256',
    })
    .result();

  const resp = evmClient
    .writeReport(runtime, {
      receiver: config.aaveReceiverAddress,
      report: reportResponse,
      gasConfig: {
        gasLimit: config.gasLimit,
      },
    })
    .result();

  const txStatus = resp.txStatus;
  const txHash = resp.txHash ? bytesToHex(resp.txHash) : undefined;

  if (txStatus !== TxStatus.SUCCESS) {
    return JSON.stringify({
      success: false,
      operation,
      amount,
      chain: config.chain,
      error: resp.errorMessage ?? `tx status: ${txStatus}`,
    } satisfies LendingResult);
  }

  runtime.log(`Aave ${operation} tx succeeded: ${txHash}`);

  return JSON.stringify({
    success: true,
    txHash,
    operation,
    amount,
    chain: config.chain,
  } satisfies LendingResult);
}

// ---------------------------------------------------------------------------
// HTTP trigger handler
//
// The file config (config.staging.json or config.production.json) provides
// defaults.  The HTTP payload can override any field — the frontend / agent
// sends the fields it wants to change and the rest come from the file.
//
// Example payload from frontend:
//   {
//     "chain": "ARBITRUM_SEPOLIA",
//     "aaveReceiverAddress": "0x...",
//     "inputConfig": {
//       "operation": "SUPPLY",
//       "asset": { "address": "0x75faf..." },
//       "amount": "1000000",
//       "walletAddress": "0x..."
//     }
//   }
//
// With a blank payload ({}) the file config is used as-is.
// ---------------------------------------------------------------------------

const onHttpTrigger = (runtime: Runtime, payload: HTTPPayload): string => {
  runtime.log('Aave lending — HTTP trigger (immediate execution)');

  const fileConfig = runtime.config as unknown as Config;

  let overrides: Record<string, unknown> = {};
  if (payload.input && payload.input.length > 0) {
    try {
      overrides = decodeJson(payload.input) as Record<string, unknown>;
      runtime.log(`Config overrides from payload: ${JSON.stringify(overrides)}`);
    } catch {
      runtime.log('No parseable overrides in HTTP payload; using file config');
    }
  }

  const merged = deepMerge(fileConfig as unknown as Record<string, unknown>, overrides) as unknown as Config;

  return doLending(runtime, merged);
};

// ---------------------------------------------------------------------------
// Workflow init + runner
//
// Only the HTTP trigger is registered (index 0).
// Invoke with:  cre workflow simulate workflow --target staging-settings \
//                 --trigger-index 0 --non-interactive --http-payload '{...}'
// ---------------------------------------------------------------------------

const initWorkflow = (_config: Config) => {
  const httpTrigger = new cre.capabilities.HTTPCapability();

  return [
    cre.handler(httpTrigger.trigger({}), onHttpTrigger),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
