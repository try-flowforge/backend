export type OstiumNetwork = 'testnet' | 'mainnet';

export interface OstiumMarketsListRequest {
  network: OstiumNetwork;
}

export interface OstiumPriceRequest {
  network: OstiumNetwork;
  base: string;
  quote?: string;
}

export interface OstiumBalanceRequest {
  network: OstiumNetwork;
  address?: string;
}

export interface OstiumPositionsListRequest {
  network: OstiumNetwork;
  traderAddress?: string;
}

export interface OstiumPositionOpenRequest {
  network: OstiumNetwork;
  market: string;
  side: 'long' | 'short';
  collateral: number;
  leverage: number;
  slPrice?: number;
  tpPrice?: number;
  traderAddress?: string;
  idempotencyKey?: string;
}

export interface OstiumPositionCloseRequest {
  network: OstiumNetwork;
  pairId: number;
  tradeIndex: number;
  traderAddress?: string;
  idempotencyKey?: string;
}

export interface OstiumPositionUpdateSlRequest {
  network: OstiumNetwork;
  pairId: number;
  tradeIndex: number;
  slPrice: number;
  traderAddress?: string;
}

export interface OstiumPositionUpdateTpRequest {
  network: OstiumNetwork;
  pairId: number;
  tradeIndex: number;
  tpPrice: number;
  traderAddress?: string;
}

export interface OstiumServiceError {
  code?: string;
  message: string;
  details?: any;
  retryable?: boolean;
}

export interface OstiumServiceEnvelope<T = any> {
  success: boolean;
  data?: T;
  error?: OstiumServiceError;
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}
