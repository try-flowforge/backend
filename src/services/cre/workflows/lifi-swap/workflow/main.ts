import {
  decodeJson,
  Runner,
  type Runtime,
  type CronPayload,
  type HTTPPayload,
  consensusIdenticalAggregation,
  type HTTPSendRequester,
  handler,
  CronCapability,
  HTTPCapability,
  HTTPClient,
} from '@chainlink/cre-sdk';
import {
  encodeFunctionData,
  parseAbi,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { setTimeout as nodeSetTimeout, clearTimeout as nodeClearTimeout } from 'node:timers';
import { z } from 'zod';

const FLOWFORGE_SAFE_MODULE_ABI = parseAbi([
  'function execTask(address safeAddress, address actionTarget, uint256 actionValue, bytes actionData, uint8 operation, uint256 declaredUsdValue) returns (bool success)',
]);

const tokenInfoSchema = z.object({
  address: z.string(),
  symbol: z.string().optional(),
  decimals: z.number().optional(),
});

const inputConfigSchema = z.object({
  sourceToken: tokenInfoSchema,
  destinationToken: tokenInfoSchema,
  amount: z.string(),
  swapType: z.enum(['EXACT_INPUT', 'EXACT_OUTPUT']),
  walletAddress: z.string(),
  slippageTolerance: z.number().optional(),
});

const configSchema = z.object({
  schedule: z.string(),
  chain: z.string(),
  chainSelectorName: z.string(),
  provider: z.literal('LIFI'),
  safeModuleAddress: z.string(),
  preflightEnabled: z.boolean().optional(),
  rpcUrl: z.string().optional(),
  gasLimit: z.string().optional(),
  inputConfig: inputConfigSchema,
});

type Config = z.infer<typeof configSchema>;

type LifiSwapResult = {
  success: boolean;
  txHash?: string;
  amountIn?: string;
  amountOut?: string;
  declaredUsdValue8?: string;
  explorerLink?: string;
  error?: string;
  errorCode?: string;
};

const MODULE_RECEIPT_WAIT_TIMEOUT_MS = 50_000;

function getLifiChainId(chain: string): number {
  switch (chain) {
    case 'ARBITRUM':
      return 42161;
    case 'ARBITRUM_SEPOLIA':
      return 421614;
    default:
      return 42161;
  }
}

function getChainDefaults(chain: string): { rpcUrl: string; explorerBaseUrl: string } {
  switch (chain) {
    case 'ARBITRUM':
      return {
        rpcUrl: 'https://arb1.arbitrum.io/rpc',
        explorerBaseUrl: 'https://arbiscan.io/tx/',
      };
    case 'ARBITRUM_SEPOLIA':
      return {
        rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
        explorerBaseUrl: 'https://sepolia.arbiscan.io/tx/',
      };
    default:
      return {
        rpcUrl: 'https://arb1.arbitrum.io/rpc',
        explorerBaseUrl: 'https://arbiscan.io/tx/',
      };
  }
}

function parseUsdTo8Decimals(rawValue: unknown): bigint | null {
  if (rawValue == null) return null;
  const numericValue =
    typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string'
      ? Number.parseFloat(rawValue)
      : NaN;

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return BigInt(Math.round(numericValue * 10 ** 8));
}

function normalizePrivateKey(privateKey: string): `0x${string}` {
  return (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;
}

function ensureTimerPolyfills(): boolean {
  const g = globalThis as {
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
  };
  if (typeof g.setTimeout === 'function' && typeof g.clearTimeout === 'function') return false;

  // CRE runtime may not expose timer globals; viem transport expects them.
  g.setTimeout = nodeSetTimeout as unknown as typeof setTimeout;
  g.clearTimeout = nodeClearTimeout as unknown as typeof clearTimeout;
  return true;
}

type RpcInput = {
  rpcUrl: string;
  method: string;
  params: unknown[];
};

const sendRpcRequest = (sendRequester: HTTPSendRequester, input: RpcInput): string => {
  const req = {
    url: input.rpcUrl,
    method: 'POST' as const,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: Buffer.from(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: input.method,
        params: input.params,
      }),
    ).toString('base64'),
  };

  const resp = sendRequester.sendRequest(req).result();
  return new TextDecoder().decode(resp.body);
};

async function rpcCall(
  runtime: Runtime<Config>,
  httpClient: HTTPClient,
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<any> {
  const raw = httpClient
    .sendRequest(runtime, sendRpcRequest, consensusIdenticalAggregation<string>())({
      rpcUrl,
      method,
      params,
    })
    .result();
  const parsed = JSON.parse(raw);
  if (parsed?.error) {
    const code = parsed.error?.code ?? 'UNKNOWN';
    const message = parsed.error?.message ?? 'Unknown RPC error';
    throw new Error(`RPC ${method} failed (${code}): ${message}`);
  }
  return parsed?.result;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error);
}

/** LI.FI expects fromAmount as integer string (BigNumberish). Convert human-readable to raw. */
function toRawAmount(amountStr: string, decimals: number): string {
  const s = String(amountStr).trim();
  if (!s) return '0';
  const num = Number(s);
  if (!Number.isFinite(num) || num < 0) return '0';
  if (num === 0) return '0';
  const mult = 10 ** decimals;
  const raw = Math.round(num * mult);
  return String(raw);
}

/** Normalize to integer string for LI.FI. Handles number (e.g. 0.5) or string ("0.5" / "500000"). */
function normalizeFromAmount(amount: unknown, decimals: number): string {
  const s = String(amount).trim();
  if (!s) return '0';
  const num = Number(s);
  if (!Number.isFinite(num)) return '0';
  if (num === 0) return '0';
  if (s.includes('.') || s.toLowerCase().includes('e') || !Number.isInteger(num)) {
    return toRawAmount(s, decimals);
  }
  return s.replace(/^0+/, '') || '0';
}

const fetchLifiQuote = (sendRequester: HTTPSendRequester, config: Config): string => {
  const chainId = getLifiChainId(config.chain);
  const inputConfig = config.inputConfig;
  const slippageParam = (inputConfig.slippageTolerance || 0.5) / 100;
  const decimals = inputConfig.sourceToken?.decimals ?? 18;
  const fromAmountRaw = normalizeFromAmount(inputConfig.amount, decimals);

  const paramsList = [
    `fromChain=${chainId}`,
    `toChain=${chainId}`,
    `fromToken=${inputConfig.sourceToken.address}`,
    `toToken=${inputConfig.destinationToken.address}`,
    `fromAmount=${fromAmountRaw}`,
    `fromAddress=${inputConfig.walletAddress}`,
    `slippage=${slippageParam}`,
    'integrator=flowforge-cre-workflow',
  ];

  const req = {
    url: `https://li.quest/v1/quote?${paramsList.join('&')}`,
    method: 'GET' as const,
    headers: {
      Accept: 'application/json',
    },
  };

  const resp = sendRequester.sendRequest(req).result();
  return new TextDecoder().decode(resp.body);
};

async function executeSwap(
  runtime: Runtime<Config>,
  dynamicConfigOverride?: Partial<Config>,
): Promise<string> {
  if (ensureTimerPolyfills()) {
    runtime.log('Installed timer polyfills for CRE runtime');
  }

  const config = {
    ...runtime.config,
    ...dynamicConfigOverride,
    inputConfig: {
      ...runtime.config.inputConfig,
      ...(dynamicConfigOverride?.inputConfig || {}),
    },
  } as Config;

  runtime.log('Fetching quote from LI.FI API...');
  const httpClient = new HTTPClient();

  let quoteDataParsed: any;
  try {
    const quoteStringResult = httpClient
      .sendRequest(runtime, fetchLifiQuote, consensusIdenticalAggregation<string>())(config)
      .result();
    quoteDataParsed = JSON.parse(quoteStringResult);
  } catch (error) {
    const message = extractErrorMessage(error);
    runtime.log(`LI.FI quote fetch failed: ${message}`);
    return JSON.stringify({
      success: false,
      error: `Failed to fetch quote: ${message}`,
      errorCode: 'LIFI_QUOTE_FAILED',
    } as LifiSwapResult);
  }

  // LI.FI can return transactionRequest (single), transactionRequests (array), or tx in first includedStep
  const txRequest =
    quoteDataParsed?.transactionRequest ??
    (Array.isArray(quoteDataParsed?.transactionRequests) && quoteDataParsed.transactionRequests.length > 0
      ? quoteDataParsed.transactionRequests[0]
      : undefined) ??
    quoteDataParsed?.includedSteps?.[0]?.transactionRequest;

  const estimate = quoteDataParsed?.estimate;

  if (!txRequest?.to || !txRequest?.data) {
    const quoteKeys = Object.keys(quoteDataParsed || {});
    const lifiMessage =
      typeof quoteDataParsed?.message === 'string'
        ? quoteDataParsed.message
        : typeof quoteDataParsed?.error === 'string'
          ? quoteDataParsed.error
          : undefined;
    const diagnostic = `Response keys: [${quoteKeys.join(', ')}]${lifiMessage ? `; LI.FI: ${lifiMessage}` : ''}`;
    runtime.log(`LI.FI invalid quote: ${diagnostic}`);
    return JSON.stringify({
      success: false,
      error: `LI.FI response did not include valid transactionRequest data. ${diagnostic}`,
      errorCode: 'LIFI_INVALID_QUOTE',
    } as LifiSwapResult);
  }

  if (!config.safeModuleAddress) {
    return JSON.stringify({
      success: false,
      error: 'safeModuleAddress is required for module execution',
      errorCode: 'MODULE_ADDRESS_MISSING',
    } as LifiSwapResult);
  }

  const declaredUsdValue8 = parseUsdTo8Decimals(estimate?.fromAmountUSD);
  if (declaredUsdValue8 == null) {
    return JSON.stringify({
      success: false,
      error: 'Unable to derive USD value from LI.FI quote (estimate.fromAmountUSD missing/invalid)',
      errorCode: 'USD_VALUE_UNAVAILABLE',
    } as LifiSwapResult);
  }

  const secretResponse = runtime.getSecret({ id: 'EXECUTOR_PRIVATE_KEY' }).result();
  const executorPrivateKey = secretResponse.value;
  if (!executorPrivateKey) {
    return JSON.stringify({
      success: false,
      error: 'Missing EXECUTOR_PRIVATE_KEY secret',
      errorCode: 'EXECUTOR_KEY_MISSING',
    } as LifiSwapResult);
  }

  const chainDefaults = getChainDefaults(config.chain);
  const rpcUrl = config.rpcUrl || chainDefaults.rpcUrl;
  runtime.log(
    `Executing module swap on chain=${config.chain} rpc=${rpcUrl} safeModule=${config.safeModuleAddress}`,
  );

  const account = privateKeyToAccount(normalizePrivateKey(executorPrivateKey));

  const args = [
    config.inputConfig.walletAddress as Address,
    txRequest.to as Address,
    BigInt(txRequest.value || '0'),
    txRequest.data as `0x${string}`,
    0,
    declaredUsdValue8,
  ] as const;

  const preflightEnabled = config.preflightEnabled === true;
  if (preflightEnabled) {
    runtime.log('Skipping module preflight simulation (disabled with RPC transport bypass)');
  } else {
    runtime.log('Skipping module preflight simulation (preflightEnabled=false)');
  }

  let txHash: `0x${string}` | undefined;
  try {
    runtime.log('Submitting module tx...');
    const nonceHex = (await rpcCall(runtime, httpClient, rpcUrl, 'eth_getTransactionCount', [
      account.address,
      'pending',
    ])) as string;
    const gasPriceHex = (await rpcCall(runtime, httpClient, rpcUrl, 'eth_gasPrice', [])) as string;
    const gasPrice = BigInt(gasPriceHex);
    const maxPriorityFeePerGas = gasPrice / 10n > 0n ? gasPrice / 10n : 1_000_000n;
    const maxFeePerGas = gasPrice * 2n + maxPriorityFeePerGas;

    const txData = encodeFunctionData({
      abi: FLOWFORGE_SAFE_MODULE_ABI,
      functionName: 'execTask',
      args,
    });

    const signedTx = await account.signTransaction({
      to: config.safeModuleAddress as Address,
      data: txData,
      value: 0n,
      gas: config.gasLimit ? BigInt(config.gasLimit) : 1_500_000n,
      nonce: Number(BigInt(nonceHex)),
      chainId: getLifiChainId(config.chain),
      maxFeePerGas,
      maxPriorityFeePerGas,
      type: 'eip1559',
    });

    txHash = (await rpcCall(runtime, httpClient, rpcUrl, 'eth_sendRawTransaction', [
      signedTx,
    ])) as `0x${string}`;
    runtime.log(`Module tx submitted: ${txHash}`);

    const explorerLink = `${chainDefaults.explorerBaseUrl}${txHash}`;
    runtime.log(`Module transaction submitted successfully: ${txHash}`);

    return JSON.stringify({
      success: true,
      txHash,
      amountIn: config.inputConfig.amount,
      amountOut: estimate?.toAmount,
      declaredUsdValue8: declaredUsdValue8.toString(),
      explorerLink,
    } as LifiSwapResult);
  } catch (error) {
    const message = extractErrorMessage(error);
    const isReceiptTimeout = /\btimeout\b|\btimed out\b/i.test(message);
    runtime.log(`Module transaction failed: ${message}`);
    return JSON.stringify({
      success: false,
      txHash,
      error: isReceiptTimeout
        ? `Timed out waiting for module tx receipt after ${Math.floor(MODULE_RECEIPT_WAIT_TIMEOUT_MS / 1000)}s: ${message}`
        : `Module transaction failed: ${message}`,
      errorCode: isReceiptTimeout ? 'MODULE_RECEIPT_TIMEOUT' : 'MODULE_EXECUTION_FAILED',
      declaredUsdValue8: declaredUsdValue8.toString(),
    } as LifiSwapResult);
  }
}

const onCronTrigger = async (
  runtime: Runtime<Config>,
  _payload: CronPayload,
): Promise<string> => {
  runtime.log('Running LI.FI swap (cron trigger)');
  return executeSwap(runtime);
};

const onHttpTrigger = async (
  runtime: Runtime<Config>,
  payload: HTTPPayload,
): Promise<string> => {
  runtime.log('Running LI.FI swap (HTTP trigger)');
  let dynamicConfigOverride: Partial<Config> | undefined;

  if (payload.input && payload.input.length > 0) {
    try {
      const body = decodeJson(payload.input);
      dynamicConfigOverride = body as Partial<Config>;
      runtime.log(`HTTP dynamic payload received: ${JSON.stringify(body)}`);
    } catch (error) {
      runtime.log(`Failed to parse HTTP payload input: ${extractErrorMessage(error)}`);
    }
  }

  return executeSwap(runtime, dynamicConfigOverride);
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  const httpTrigger = new HTTPCapability();

  return [
    handler(
      cron.trigger({
        schedule: config.schedule,
      }),
      onCronTrigger,
    ),
    handler(httpTrigger.trigger({}), onHttpTrigger),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
