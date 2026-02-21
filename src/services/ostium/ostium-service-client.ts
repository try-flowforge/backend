import axios from 'axios';
import { logger } from '../../utils/logger';
import { signRequest, HMAC_HEADERS } from '../../utils/hmac';
import {
  OstiumBalanceRequest,
  OstiumMarketsListRequest,
  OstiumPositionCloseRequest,
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
          const errorCode = responseData.error?.code || 'OSTIUM_SERVICE_ERROR';
          const errorMessage = responseData.error?.message || 'Invalid response from Ostium service';
          throw new OstiumServiceClientError(
            errorCode,
            errorMessage,
            response.status,
            responseData.error?.retryable,
            responseData.error?.details,
          );
        }

        return responseData.data;
      } catch (error) {
        const isAxiosError = axios.isAxiosError(error);
        const status = isAxiosError ? error.response?.status : undefined;
        const shouldRetry = attempt < maxRetries && (status == null || status >= 500);

        if (shouldRetry) {
          const waitMs = retryDelaysMs[attempt] ?? retryDelaysMs[retryDelaysMs.length - 1];
          logger.warn(
            {
              path,
              attempt: attempt + 1,
              waitMs,
              status,
              error: error instanceof Error ? error.message : String(error),
            },
            'Ostium service call failed, retrying',
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        if (isAxiosError && error.response?.data?.error) {
          const serviceError = error.response.data.error;
          throw new OstiumServiceClientError(
            serviceError.code || 'OSTIUM_SERVICE_ERROR',
            serviceError.message || error.message,
            error.response.status,
            serviceError.retryable,
            serviceError.details,
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

  async listMarkets(request: OstiumMarketsListRequest, requestId?: string): Promise<any> {
    return this.signedPost<OstiumMarketsListRequest, any>('/v1/markets/list', request, requestId);
  }

  async getPrice(request: OstiumPriceRequest, requestId?: string): Promise<any> {
    return this.signedPost<OstiumPriceRequest, any>('/v1/prices/get', request, requestId);
  }

  async getBalance(request: OstiumBalanceRequest, requestId?: string): Promise<any> {
    return this.signedPost<OstiumBalanceRequest, any>('/v1/accounts/balance', request, requestId);
  }

  async listPositions(request: OstiumPositionsListRequest, requestId?: string): Promise<any> {
    return this.signedPost<OstiumPositionsListRequest, any>('/v1/positions/list', request, requestId);
  }

  async openPosition(request: OstiumPositionOpenRequest, requestId?: string): Promise<any> {
    return this.signedPost<OstiumPositionOpenRequest, any>('/v1/positions/open', request, requestId);
  }

  async closePosition(request: OstiumPositionCloseRequest, requestId?: string): Promise<any> {
    return this.signedPost<OstiumPositionCloseRequest, any>('/v1/positions/close', request, requestId);
  }

  async updateStopLoss(request: OstiumPositionUpdateSlRequest, requestId?: string): Promise<any> {
    return this.signedPost<OstiumPositionUpdateSlRequest, any>('/v1/positions/update-sl', request, requestId);
  }

  async updateTakeProfit(request: OstiumPositionUpdateTpRequest, requestId?: string): Promise<any> {
    return this.signedPost<OstiumPositionUpdateTpRequest, any>('/v1/positions/update-tp', request, requestId);
  }
}

export const ostiumServiceClient = new OstiumServiceClient();
