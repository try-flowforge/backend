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
  collateral: string;
  leverage: string;
  orderType?: 'market' | 'limit' | 'stop';
  triggerPrice?: string;
  slippage?: string;
  slPrice?: string;
  tpPrice?: string;
  traderAddress?: string;
  idempotencyKey?: string;
}

export interface OstiumPositionCloseRequest {
  network: OstiumNetwork;
  pairId: string | number;
  tradeIndex: string | number;
  closePercentage?: string | number;
  traderAddress?: string;
  idempotencyKey?: string;
}

export interface OstiumPositionUpdateSlRequest {
  network: OstiumNetwork;
  pairId: string | number;
  tradeIndex: string | number;
  slPrice: string;
  traderAddress?: string;
}

export interface OstiumPositionUpdateTpRequest {
  network: OstiumNetwork;
  pairId: string | number;
  tradeIndex: string | number;
  tpPrice: string;
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
  triggerPrice?: string;
  slPrice?: string;
  tpPrice?: string;
  traderAddress?: string;
}

export interface OstiumOrderTrackRequest {
  network: OstiumNetwork;
  orderId: string;
}

// Metrics & Account
export interface OstiumPositionMetricsRequest {
  network: OstiumNetwork;
  pairId: string | number;
  tradeIndex: string | number;
  traderAddress?: string;
}

export interface OstiumHistoryRequest extends OstiumPositionsListRequest {
  limit?: string | number;
}

export interface OstiumFaucetRequest {
  network: OstiumNetwork;
  traderAddress?: string;
}

// Market Details
export interface OstiumMarketFundingRequest {
  network: OstiumNetwork;
  pairId: string | number;
  periodHours?: number;
}

export interface OstiumMarketDetailsRequest {
  network: OstiumNetwork;
  pairId: string | number;
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
