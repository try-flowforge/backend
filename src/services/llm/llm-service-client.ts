import axios, { AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { signRequest, HMAC_HEADERS } from '../../utils/hmac';

const LLM_SERVICE_BASE_URL = process.env.LLM_SERVICE_BASE_URL || 'http://localhost:3002';
const HMAC_SECRET = process.env.HMAC_SECRET || '';

// Request timeout (60 seconds)
const REQUEST_TIMEOUT = 200000;

// Cache for models list (5 minutes TTL)
let modelsCache: any = null;
let modelsCacheExpiry = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  provider: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  responseSchema?: Record<string, any>;
  requestId: string;
  userId: string;
}

export interface ChatResponse {
  text: string;
  json?: Record<string, any>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  providerRequestId?: string;
  model: string;
}

export interface ModelDefinition {
  id: string;
  provider: string;
  displayName: string;
  model: string;
  maxTokens: number;
  supportsJsonMode: boolean;
  costTier?: 'free' | 'paid';
}

export class LLMServiceClient {
  async listModels(forceRefresh = false): Promise<ModelDefinition[]> {
    // Return cached if valid
    if (!forceRefresh && modelsCache && Date.now() < modelsCacheExpiry) {
      logger.debug('Returning cached models list');
      return modelsCache;
    }

    try {
      const url = `${LLM_SERVICE_BASE_URL}/v1/models`;

      logger.debug({ url }, 'Fetching models list from LLM service');

      const path = '/v1/models';
      const { timestamp, signature } = signRequest(HMAC_SECRET, 'GET', path, '');

      const response = await axios.get(url, {
        headers: {
          [HMAC_HEADERS.TIMESTAMP]: timestamp,
          [HMAC_HEADERS.SIGNATURE]: signature,
        },
        timeout: REQUEST_TIMEOUT,
      });

      if (response.status !== 200) {
        throw new Error(`LLM service returned status ${response.status}: ${JSON.stringify(response.data)}`);
      }

      const responseData = response.data as any;

      if (!responseData.success || !responseData.data?.models) {
        throw new Error('Invalid response from LLM service');
      }

      // Update cache
      modelsCache = responseData.data.models;
      modelsCacheExpiry = Date.now() + MODELS_CACHE_TTL;

      logger.info({ modelCount: modelsCache.length }, 'Models list fetched and cached');

      return modelsCache;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to fetch models from LLM service');

      // Return cached if available, even if expired
      if (modelsCache) {
        logger.warn('Returning stale cached models due to fetch error');
        return modelsCache;
      }

      throw error;
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();

    try {
      const url = `${LLM_SERVICE_BASE_URL}/v1/chat`;

      logger.info({
        requestId: request.requestId,
        provider: request.provider,
        model: request.model,
        userId: request.userId,
      }, 'Sending chat request to LLM service');

      const path = '/v1/chat';
      const bodyStr = JSON.stringify(request);
      const { timestamp, signature } = signRequest(HMAC_SECRET, 'POST', path, bodyStr);

      const response = await axios.post(url, request, {
        headers: {
          'Content-Type': 'application/json',
          [HMAC_HEADERS.TIMESTAMP]: timestamp,
          [HMAC_HEADERS.SIGNATURE]: signature,
        },
        timeout: REQUEST_TIMEOUT,
      });

      const latencyMs = Date.now() - startTime;

      if (response.status !== 200) {
        logger.error({
          requestId: request.requestId,
          statusCode: response.status,
          latencyMs,
          response: response.data,
        }, 'LLM service returned error');

        const errorData = response.data as any;
        throw new Error(errorData.error?.message || `LLM service error (${response.status})`);
      }

      const responseData = response.data;

      if (!responseData.success || !responseData.data) {
        throw new Error('Invalid response from LLM service');
      }

      logger.info({
        requestId: request.requestId,
        latencyMs,
        usage: responseData.data.usage,
      }, 'Chat request completed');

      return responseData.data;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof AxiosError
        ? error.response?.data?.error?.message || error.message
        : error instanceof Error
          ? error.message
          : String(error);

      logger.error({
        requestId: request.requestId,
        provider: request.provider,
        model: request.model,
        latencyMs,
        error: errorMessage,
      }, 'Chat request to LLM service failed');

      throw error instanceof AxiosError && error.response?.data?.error
        ? new Error(error.response.data.error.message || `LLM service error (${error.response.status})`)
        : error;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; providers?: { openai: boolean; openrouter: boolean } }> {
    try {
      const url = `${LLM_SERVICE_BASE_URL}/health`;

      const response = await axios.get(url, {
        timeout: 5000,
      });

      if (response.status !== 200) {
        return { healthy: false };
      }

      const responseData = response.data as any;

      return {
        healthy: responseData.status === 'healthy',
        providers: responseData.providers,
      };
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
      }, 'LLM service health check failed');

      return { healthy: false };
    }
  }
}

// Singleton instance
export const llmServiceClient = new LLMServiceClient();
