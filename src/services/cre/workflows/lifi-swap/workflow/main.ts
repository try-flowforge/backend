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

import { z } from 'zod';

// ---------- Config schema ----------

const tokenInfoSchema = z.object({
    address: z.string(),
    symbol: z.string().optional(),
    decimals: z.number().optional(),
});

const inputConfigSchema = z.object({
    sourceToken: tokenInfoSchema,
    destinationToken: tokenInfoSchema,
    amount: z.string(), // raw amount string
    swapType: z.enum(['EXACT_INPUT', 'EXACT_OUTPUT']),
    walletAddress: z.string(),
    slippageTolerance: z.number().optional(),
});

const configSchema = z.object({
    schedule: z.string(),
    chain: z.string(),
    chainSelectorName: z.string(),
    provider: z.literal('LIFI'),
    swapReceiverAddress: z.string().optional(),
    gasLimit: z.string().optional(),
    inputConfig: inputConfigSchema,
});

type Config = z.infer<typeof configSchema>;

export type LifiQuoteResult = {
    success: boolean;
    transactionRequest?: {
        to: string;
        data: string;
        value: string;
        gasLimit?: string;
    };
    estimate?: {
        fromAmount: string;
        toAmount: string;
        toAmountMin: string;
        approvalAddress?: string;
    };
    error?: string;
};

// Map FlowForge SupportedChains to LI.FI chain IDs (Arbitrum=42161)
function getLifiChainId(chain: string): number {
    switch (chain) {
        case 'ARBITRUM': return 42161;
        case 'ARBITRUM_SEPOLIA': return 421614;
        default: return 42161; // fallback
    }
}

// ---------- API Request for LI.FI Quote ----------

const fetchLifiQuote = (sendRequester: HTTPSendRequester, config: Config): string => {
    const chainId = getLifiChainId(config.chain);
    const inputConfig = config.inputConfig;

    // e.g. 0.5% needs to be passed as 0.005 in LI.FI
    const slippageParam = (inputConfig.slippageTolerance || 0.5) / 100;

    // Construct search params manually for HTTP capability
    const paramsList = [
        `fromChain=${chainId}`,
        `toChain=${chainId}`,
        `fromToken=${inputConfig.sourceToken.address}`,
        `toToken=${inputConfig.destinationToken.address}`,
        `fromAmount=${inputConfig.amount}`,
        `fromAddress=${inputConfig.walletAddress}`,
        `slippage=${slippageParam}`,
        `integrator=flowforge-cre-template`
    ];

    const url = `https://li.quest/v1/quote?${paramsList.join('&')}`;

    const req = {
        url,
        method: 'GET' as const,
        headers: {
            'Accept': 'application/json',
        },
    };

    const resp = sendRequester.sendRequest(req).result();
    const rawData = new TextDecoder().decode(resp.body);

    return rawData;
};

// ---------- Workflow Logic (quote-only, no on-chain write) ----------

function getQuote(runtime: Runtime<Config>, dynamicConfigOverride?: Partial<Config>): string {
    const config = {
        ...runtime.config,
        ...dynamicConfigOverride,
        inputConfig: {
            ...runtime.config.inputConfig,
            ...(dynamicConfigOverride?.inputConfig || {})
        }
    } as Config;

    // 1. Fetch quote from LI.FI
    runtime.log('Fetching quote from LI.FI API...');
    const httpClient = new HTTPClient();

    let quoteDataParsed: any;
    try {
        const quoteStringResult = httpClient
            .sendRequest(
                runtime,
                fetchLifiQuote,
                consensusIdenticalAggregation<string>()
            )(config)
            .result();

        runtime.log(`Raw LI.FI Response: ${quoteStringResult}`);
        quoteDataParsed = JSON.parse(quoteStringResult);
    } catch (err: any) {
        runtime.log(`Failed to fetch quote: ${err.message}`);
        return JSON.stringify({
            success: false,
            error: `Failed to fetch quote: ${err.message}`,
        } as LifiQuoteResult);
    }

    const txRequest = quoteDataParsed?.transactionRequest;
    const estimate = quoteDataParsed?.estimate;

    if (!txRequest || !txRequest.to || !txRequest.data) {
        return JSON.stringify({
            success: false,
            error: 'LI.FI response did not include valid transactionRequest data. Check token config.',
        } as LifiQuoteResult);
    }

    runtime.log(`Quote received. Expected Output: ${estimate?.toAmount}`);

    const result: LifiQuoteResult = {
        success: true,
        transactionRequest: {
            to: txRequest.to,
            data: txRequest.data,
            value: txRequest.value || '0',
            gasLimit: txRequest.gasLimit,
        },
        estimate: estimate ? {
            fromAmount: estimate.fromAmount ?? '',
            toAmount: estimate.toAmount ?? '',
            toAmountMin: estimate.toAmountMin ?? '',
            approvalAddress: estimate.approvalAddress,
        } : undefined,
    };
    return JSON.stringify(result);
}

// ---------- Handlers ----------

const onCronTrigger = (runtime: Runtime<Config>, _payload: CronPayload): string => {
    runtime.log('Running LI.FI quote (cron trigger)');
    return getQuote(runtime);
};

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
    runtime.log('Running LI.FI quote (HTTP trigger)');

    let dynamicConfigOverride: Partial<Config> | undefined;

    if (payload.input && payload.input.length > 0) {
        try {
            const body = decodeJson(payload.input);
            runtime.log(`HTTP dynamic payload received: ${JSON.stringify(body)}`);
            dynamicConfigOverride = body as Partial<Config>;
        } catch (err: any) {
            runtime.log(`Failed to parse HTTP payload input. Using default config. Error: ${err.message}`);
        }
    }

    return getQuote(runtime, dynamicConfigOverride);
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
