import axios from 'axios';
import { logger } from '../../utils/logger';
import { signRequest, HMAC_HEADERS } from '../../utils/hmac';
import {
  OstiumBalanceRequest,
  OstiumFaucetRequest,
  OstiumHistoryRequest,
  OstiumMarketDetailsRequest,
  OstiumMarketFundingRequest,
  OstiumMarketsListRequest,
  OstiumOrderCancelRequest,
  OstiumOrderTrackRequest,
  OstiumOrderUpdateRequest,
  OstiumPositionCloseRequest,
  OstiumPositionMetricsRequest,
  OstiumPositionOpenRequest,
  OstiumPositionsListRequest,
  OstiumPositionUpdateSlRequest,
  OstiumPositionUpdateTpRequest,
  OstiumPriceRequest,
  OstiumServiceEnvelope,
} from '../../types/ostium.types';

const OSTIUM_SERVICE_BASE_URL = process.env.OSTIUM_SERVICE_BASE_URL || 'http://localhost:5002';
const OSTIUM_SERVICE_HMAC_SECRET = process.env.OSTIUM_SERVICE_HMAC_SECRET || process.env.HMAC_SECRET || '';
const REQUEST_TIMEOUT = Number(process.env.OSTIUM_REQUEST_TIMEOUT_MS || 30000);

interface RawServiceError {
  code?: string;
  message?: string;
  details?: any;
  retryable?: boolean;
}

export class OstiumServiceClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly retryable?: boolean,
    public readonly details?: any,
  ) {
    super(message);
    this.name = 'OstiumServiceClientError';
  }
}

export class OstiumServiceClient {
  private getNestedError(details: unknown): string | null {
    if (!details || typeof details !== 'object') return null;
    const maybeDetails = details as { error?: unknown };
    return typeof maybeDetails.error === 'string' ? maybeDetails.error : null;
  }

  private normalizeServiceError(
    serviceError: RawServiceError,
    fallbackStatusCode?: number,
  ): {
    code: string;
    message: string;
    statusCode: number;
    retryable?: boolean;
    details?: any;
  } {
    const code = serviceError.code || 'OSTIUM_SERVICE_ERROR';
    const message = serviceError.message || 'Ostium request failed';
    const nested = this.getNestedError(serviceError.details);
    const haystack = `${message} ${nested ?? ''}`.toLowerCase();

    if (haystack.includes('sufficient allowance') || haystack.includes('allowance for')) {
      return {
        code: 'ALLOWANCE_MISSING',
        message: 'Sufficient allowance not present. Approve the Ostium trading storage contract to spend USDC.',
        statusCode: 400,
        retryable: false,
        details: serviceError.details,
      };
    }

    if (haystack.includes('delegation is not active') || haystack.includes('delegation not active')) {
      return {
        code: 'DELEGATION_NOT_ACTIVE',
        message: 'Delegation is not active. Approve delegation before running write actions.',
        statusCode: 400,
        retryable: false,
        details: serviceError.details,
      };
    }

    if (haystack.includes('safe wallet not found')) {
      return {
        code: 'SAFE_WALLET_MISSING',
        message: 'Safe wallet not found for selected network.',
        statusCode: 400,
        retryable: false,
        details: serviceError.details,
      };
    }

    if (haystack.includes('delegate wallet gas is low') || haystack.includes('insufficient funds for gas')) {
      return {
        code: 'DELEGATE_GAS_LOW',
        message: 'Delegate wallet gas is low. Fund delegate wallet with ETH.',
        statusCode: 400,
        retryable: false,
        details: serviceError.details,
      };
    }

    if (haystack.includes('timeout of') || haystack.includes('timed out') || haystack.includes('timeout')) {
      return {
        code: 'OSTIUM_SERVICE_TIMEOUT',
        message: 'Ostium service timed out.',
        statusCode: 504,
        retryable: true,
        details: serviceError.details,
      };
    }

    return {
      code,
      message,
      statusCode: fallbackStatusCode || 500,
      retryable: serviceError.retryable,
      details: serviceError.details,
    };
  }

  private async signedPost<TRequest extends object, TResponse>(
    path: string,
    payload: TRequest,
    requestId?: string,
  ): Promise<TResponse> {
    const bodyStr = JSON.stringify(payload);
    const { timestamp, signature } = signRequest(OSTIUM_SERVICE_HMAC_SECRET, 'POST', path, bodyStr);
    const url = `${OSTIUM_SERVICE_BASE_URL}${path}`;

    const maxRetries = 2;
    const retryDelaysMs = [500, 1000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        logger.info({ url, payload, requestId }, 'Sending Ostium service request');
        const response = await axios.post(url, payload, {
          timeout: REQUEST_TIMEOUT,
          headers: {
            'Content-Type': 'application/json',
            [HMAC_HEADERS.TIMESTAMP]: timestamp,
            [HMAC_HEADERS.SIGNATURE]: signature,
            ...(requestId ? { 'x-request-id': requestId } : {}),
          },
        });

        const responseData = response.data as OstiumServiceEnvelope<TResponse>;

        if (!responseData.success || !responseData.data) {
          const normalized = this.normalizeServiceError(
            (responseData.error || {}) as RawServiceError,
            response.status,
          );
          throw new OstiumServiceClientError(
            normalized.code,
            normalized.message,
            normalized.statusCode,
            normalized.retryable,
            normalized.details,
          );
        }

        return responseData.data;
      } catch (error) {
        const isAxiosError = axios.isAxiosError(error);
        const status = isAxiosError ? error.response?.status : undefined;
        const serviceError = isAxiosError ? (error.response?.data?.error as RawServiceError | undefined) : undefined;
        const normalizedServiceError = serviceError ? this.normalizeServiceError(serviceError, status) : undefined;
        const retryableFromService =
          normalizedServiceError && typeof normalizedServiceError.retryable === 'boolean'
            ? normalizedServiceError.retryable
            : undefined;
        const normalizedStatus = normalizedServiceError?.statusCode ?? status;
        const shouldRetry =
          attempt < maxRetries &&
          (normalizedStatus == null || (normalizedStatus >= 500 && retryableFromService !== false));

        if (shouldRetry) {
          const waitMs = retryDelaysMs[attempt] ?? retryDelaysMs[retryDelaysMs.length - 1];
          logger.warn(
            {
              path,
              attempt: attempt + 1,
              waitMs,
              status: normalizedStatus,
              serviceErrorCode: normalizedServiceError?.code,
              retryableFromService,
              error: error instanceof Error ? error.message : String(error),
            },
            'Ostium service call failed, retrying',
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        if (normalizedServiceError) {
          const fallbackMessage = error instanceof Error ? error.message : String(error);
          throw new OstiumServiceClientError(
            normalizedServiceError.code || 'OSTIUM_SERVICE_ERROR',
            normalizedServiceError.message || fallbackMessage,
            normalizedServiceError.statusCode || status || 500,
            normalizedServiceError.retryable,
            normalizedServiceError.details,
          );
        }

        throw new OstiumServiceClientError(
          'OSTIUM_SERVICE_REQUEST_FAILED',
          error instanceof Error ? error.message : String(error),
          status || 500,
          true,
        );
      }
    }

    throw new OstiumServiceClientError('OSTIUM_SERVICE_REQUEST_FAILED', 'Unexpected retry termination', 500, true);
  }

  // Market Intelligence
  async listMarkets(request: OstiumMarketsListRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/markets/list', request, requestId);
  }

  async getPrice(request: OstiumPriceRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/prices/get', request, requestId);
  }

  async getMarketFunding(request: OstiumMarketFundingRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/markets/funding-rate', request, requestId);
  }

  async getMarketRollover(request: OstiumMarketFundingRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/markets/rollover-rate', request, requestId);
  }

  async getMarketDetails(request: OstiumMarketDetailsRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/markets/details', request, requestId);
  }

  // Trading & Positions
  async openPosition(request: OstiumPositionOpenRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/positions/open', request, requestId);
  }

  async closePosition(request: OstiumPositionCloseRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/positions/close', request, requestId);
  }

  async updateStopLoss(request: OstiumPositionUpdateSlRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/positions/update-sl', request, requestId);
  }

  async updateTakeProfit(request: OstiumPositionUpdateTpRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/positions/update-tp', request, requestId);
  }

  async getPositionMetrics(request: OstiumPositionMetricsRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/positions/metrics', request, requestId);
  }

  // Order Management
  async listOrders(request: OstiumPositionsListRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/orders/list', request, requestId);
  }

  async cancelOrder(request: OstiumOrderCancelRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/orders/cancel', request, requestId);
  }

  async updateOrder(request: OstiumOrderUpdateRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/orders/update', request, requestId);
  }

  async trackOrder(request: OstiumOrderTrackRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/orders/track', request, requestId);
  }

  // Account & Utilities
  async getBalance(request: OstiumBalanceRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/accounts/balance', request, requestId);
  }

  async listPositions(request: OstiumPositionsListRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/positions/list', request, requestId);
  }

  async getHistory(request: OstiumHistoryRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/accounts/history', request, requestId);
  }

  async requestFaucet(request: OstiumFaucetRequest, requestId?: string): Promise<any> {
    return this.signedPost('/v1/faucet/request', request, requestId);
  }
}

export const ostiumServiceClient = new OstiumServiceClient();
