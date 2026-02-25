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
  orderType?: 'market' | 'limit' | 'stop';
  triggerPrice?: number;
  slippage?: number;
  slPrice?: number;
  tpPrice?: number;
  traderAddress?: string;
  idempotencyKey?: string;
}

export interface OstiumPositionCloseRequest {
  network: OstiumNetwork;
  pairId: number;
  tradeIndex: number;
  closePercentage?: number;
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

// Order Management
export interface OstiumOrderCancelRequest {
  network: OstiumNetwork;
  orderId: string;
  traderAddress?: string;
}

export interface OstiumOrderUpdateRequest {
  network: OstiumNetwork;
  orderId: string;
  triggerPrice?: number;
  slPrice?: number;
  tpPrice?: number;
  traderAddress?: string;
}

export interface OstiumOrderTrackRequest {
  network: OstiumNetwork;
  orderId: string;
}

// Metrics & Account
export interface OstiumPositionMetricsRequest {
  network: OstiumNetwork;
  pairId: number;
  tradeIndex: number;
  traderAddress?: string;
}

export interface OstiumHistoryRequest extends OstiumPositionsListRequest {
  limit?: number;
}

export interface OstiumFaucetRequest {
  network: OstiumNetwork;
  traderAddress?: string;
}

// Market Details
export interface OstiumMarketFundingRequest {
  network: OstiumNetwork;
  pairId: number;
  periodHours?: number;
}

export interface OstiumMarketDetailsRequest {
  network: OstiumNetwork;
  pairId: number;
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
