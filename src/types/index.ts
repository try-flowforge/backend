// User Types
export interface User {
  id: string;
  address: string;
  email: string;
  onboarded_at: Date;
  safe_wallets?: Record<string, string>; // ChainId -> SafeAddress
  remaining_sponsored_txs?: number;
  selected_chains?: string[];
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
    offset?: number;
  };
}

// Re-export all swap-related types
export * from './swap.types';

// Re-export all lending-related types
export * from './lending.types';

// Re-export all oracle-related types
export * from './oracle.types';

