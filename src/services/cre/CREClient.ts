import { logger } from '../../utils/logger';
import { SupportedChain } from '../../types';

type JsonRpcRequest<TInput> = {
  jsonrpc: '2.0';
  id: string;
  method: 'workflows.execute';
  params: {
    input: TInput;
    workflow: {
      workflowID: string;
    };
  };
};

type JsonRpcSuccess<T> = {
  jsonrpc: '2.0';
  id: string;
  result: T;
};

type JsonRpcError = {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError;

export interface CREClientOptions {
  gatewayUrl: string;
  oracleWorkflowId?: string;
  lifiSwapWorkflowId?: string;
  /**
   * Optional pre-generated bearer token for CRE HTTP trigger auth.
   * When unset, no Authorization header is added and calls will fail
   * for deployed workflows that require auth.
   */
  authToken?: string;
}

export class CREClient {
  private readonly gatewayUrl: string;
  private readonly oracleWorkflowId?: string;
  private readonly lifiSwapWorkflowId?: string;
  private readonly authToken?: string;

  constructor(options?: Partial<CREClientOptions>) {
    const gatewayUrl =
      options?.gatewayUrl ||
      process.env.CRE_GATEWAY_URL ||
      '';

    if (!gatewayUrl) {
      logger.warn('CRE_GATEWAY_URL is not set; CREClient will be inactive.');
    }

    this.gatewayUrl = gatewayUrl;
    this.oracleWorkflowId =
      options?.oracleWorkflowId || process.env.CRE_ORACLE_WORKFLOW_ID;
    this.lifiSwapWorkflowId =
      options?.lifiSwapWorkflowId || process.env.CRE_LIFI_SWAP_WORKFLOW_ID;
    this.authToken = options?.authToken || process.env.CRE_AUTH_TOKEN;
  }

  isConfigured(): boolean {
    return !!this.gatewayUrl;
  }

  async invokeWorkflow<TInput, TResult>(
    workflowId: string,
    input: TInput,
  ): Promise<TResult> {
    if (!this.gatewayUrl) {
      throw new Error('CRE gateway URL is not configured');
    }

    if (!workflowId) {
      throw new Error('CRE workflow ID is required');
    }

    const requestId = `ff-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const body: JsonRpcRequest<TInput> = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'workflows.execute',
      params: {
        input,
        workflow: {
          workflowID: workflowId,
        },
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    const res = await fetch(this.gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `CRE gateway request failed with status ${res.status}: ${text}`,
      );
    }

    const json = (await res.json()) as JsonRpcResponse<TResult>;

    if ('error' in json) {
      throw new Error(
        `CRE workflow error (${json.error.code}): ${json.error.message}`,
      );
    }

    return json.result;
  }

  async invokeOracle<TInput, TResult>(input: TInput): Promise<TResult> {
    if (!this.oracleWorkflowId) {
      throw new Error('CRE_ORACLE_WORKFLOW_ID is not configured');
    }
    return this.invokeWorkflow<TInput, TResult>(
      this.oracleWorkflowId,
      input,
    );
  }

  async invokeLifiSwap<TInput, TResult>(input: TInput): Promise<TResult> {
    if (!this.lifiSwapWorkflowId) {
      throw new Error('CRE_LIFI_SWAP_WORKFLOW_ID is not configured');
    }
    return this.invokeWorkflow<TInput, TResult>(
      this.lifiSwapWorkflowId,
      input,
    );
  }
}

export const creClient = new CREClient();

export function mapSupportedChainToChainName(chain: SupportedChain): string {
  switch (chain) {
    case SupportedChain.ARBITRUM:
      return 'ethereum-mainnet-arbitrum-1';
    case SupportedChain.ARBITRUM_SEPOLIA:
      return 'ethereum-testnet-sepolia-arbitrum-1';
    default:
      return 'ethereum-mainnet-arbitrum-1';
  }
}

