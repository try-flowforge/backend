import {
  bytesToHex,
  cre,
  decodeJson,
  encodeCallMsg,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  Runner,
  type Runtime,
  type CronPayload,
  type HTTPPayload,
} from '@chainlink/cre-sdk';
import { encodeFunctionData, decodeFunctionResult, type Address, zeroAddress } from 'viem';
import { z } from 'zod';
import { PriceFeedAggregator } from './contracts/abi/PriceFeedAggregator';

const configSchema = z.object({
  schedule: z.string(),
  chainName: z.string(),
  feeds: z.array(
    z.object({
      name: z.string(),
      address: z.string(),
    }),
  ),
  staleAfterSeconds: z.number().optional(),
});

type Config = z.infer<typeof configSchema>;

type OracleCREOutput = {
  provider: 'CHAINLINK';
  chain: string;
  aggregatorAddress: string;
  description?: string;
  decimals: number;
  roundId: string;
  answeredInRound: string;
  startedAt: number;
  updatedAt: number;
  answer: string;
  formattedAnswer: string;
};

function getEvmClient(chainName: string, isTestnet: boolean) {
  const net = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: chainName,
    isTestnet,
  });
  if (!net) throw new Error(`Network not found for chain name: ${chainName}`);
  return new cre.capabilities.EVMClient(net.chainSelector.selector);
}

function formatScaled(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const s = raw.toString();
  if (s.length <= decimals) {
    return `0.${s.padStart(decimals, '0')}`;
  }
  const i = s.length - decimals;
  return `${s.slice(0, i)}.${s.slice(i)}`;
}

const safeJsonStringify = (obj: unknown) =>
  JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

function isTestnetChain(chainName: string): boolean {
  return (
    chainName.toLowerCase().includes('sepolia') ||
    chainName.toLowerCase().includes('testnet')
  );
}

function readFeed(
  runtime: Runtime<Config>,
  evmClient: InstanceType<typeof cre.capabilities.EVMClient>,
  chainName: string,
  config: Config,
  name: string,
  address: string,
): OracleCREOutput {
  const decCallData = encodeFunctionData({
    abi: PriceFeedAggregator,
    functionName: 'decimals',
  });

  const decResp = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: address as Address,
        data: decCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const decimals = decodeFunctionResult({
    abi: PriceFeedAggregator,
    functionName: 'decimals',
    data: bytesToHex(decResp.data),
  }) as number;

  let description: string | undefined;
  try {
    const descCallData = encodeFunctionData({
      abi: PriceFeedAggregator,
      functionName: 'description',
    });
    const descResp = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: address as Address,
          data: descCallData,
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();
    description = decodeFunctionResult({
      abi: PriceFeedAggregator,
      functionName: 'description',
      data: bytesToHex(descResp.data),
    }) as string;
  } catch {
    // optional
  }

  const roundCallData = encodeFunctionData({
    abi: PriceFeedAggregator,
    functionName: 'latestRoundData',
  });

  const roundResp = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: address as Address,
        data: roundCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const [roundId, answer, startedAt, updatedAt, answeredInRound] = decodeFunctionResult({
    abi: PriceFeedAggregator,
    functionName: 'latestRoundData',
    data: bytesToHex(roundResp.data),
  }) as [bigint, bigint, bigint, bigint, bigint];

  if (config.staleAfterSeconds !== undefined) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const updatedAtNum = Number(updatedAt);
    if (
      updatedAtNum === 0 ||
      nowSeconds - updatedAtNum > config.staleAfterSeconds
    ) {
      throw new Error(
        `Stale Chainlink price | feed=${name} address=${address} updatedAt=${updatedAtNum} now=${nowSeconds} staleAfterSeconds=${config.staleAfterSeconds}`,
      );
    }
  }

  const formattedAnswer = formatScaled(answer, decimals);

  runtime.log(
    `Price feed read | chain=${chainName} feed="${name}" address=${address} decimals=${decimals} latestAnswerRaw=${answer.toString()} latestAnswerScaled=${formattedAnswer}`,
  );

  return {
    provider: 'CHAINLINK',
    chain: chainName,
    aggregatorAddress: address,
    description,
    decimals,
    roundId: roundId.toString(),
    answeredInRound: answeredInRound.toString(),
    startedAt: Number(startedAt),
    updatedAt: Number(updatedAt),
    answer: answer.toString(),
    formattedAnswer,
  };
}

function onCron(runtime: Runtime<Config>, _payload: CronPayload): string {
  const isTestnet = isTestnetChain(runtime.config.chainName);
  const evmClient = getEvmClient(runtime.config.chainName, isTestnet);
  const results = runtime.config.feeds.map((f) =>
    readFeed(
      runtime,
      evmClient,
      runtime.config.chainName,
      runtime.config,
      f.name,
      f.address,
    ),
  );
  return safeJsonStringify({ results });
}

function onHttpTrigger(runtime: Runtime<Config>, payload: HTTPPayload): string {
  let override: Partial<Config> | undefined;
  if (payload.input && payload.input.length > 0) {
    try {
      override = decodeJson(payload.input) as Partial<Config>;
      runtime.log(`HTTP payload override parsed: ${JSON.stringify(override)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      runtime.log(`HTTP payload decodeJson failed: ${msg}`);
      try {
        const raw = new TextDecoder().decode(payload.input);
        runtime.log(`HTTP payload raw text: ${raw}`);
        override = JSON.parse(raw) as Partial<Config>;
        runtime.log(`HTTP payload JSON.parse fallback succeeded`);
      } catch {
        runtime.log(`HTTP payload JSON.parse fallback also failed`);
      }
    }
  } else {
    runtime.log(`HTTP payload.input is empty or missing`);
  }

  const effectiveConfig: Config = {
    ...runtime.config,
    ...override,
    feeds: override?.feeds ?? runtime.config.feeds,
  };

  const isTestnet = isTestnetChain(effectiveConfig.chainName);
  const evmClient = getEvmClient(effectiveConfig.chainName, isTestnet);

  const results: OracleCREOutput[] = effectiveConfig.feeds.map((f) =>
    readFeed(
      runtime,
      evmClient,
      effectiveConfig.chainName,
      effectiveConfig,
      f.name,
      f.address,
    ),
  );

  return safeJsonStringify({ results });
}

function initWorkflow(config: Config) {
  const cron = new cre.capabilities.CronCapability();
  const http = new cre.capabilities.HTTPCapability();
  return [
    cre.handler(
      cron.trigger({ schedule: config.schedule }),
      onCron,
    ),
    cre.handler(
      http.trigger({}),
      onHttpTrigger,
    ),
  ];
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();

