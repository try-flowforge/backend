// User Types
export interface User {
  id: string;
  address: string;
  email: string;
  onboarded_at: Date;
  safe_wallet_address_testnet?: string;
  safe_wallet_address_mainnet?: string;
}

export interface CreateUserInput {
  id: string;
  address: string;
  email: string;
  onboarded_at?: Date;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
    total?: number;
    page?: number;
    limit?: number;
  };
}

// Re-export all swap-related types
export * from './swap.types';

// Re-export all lending-related types
export * from './lending.types';

