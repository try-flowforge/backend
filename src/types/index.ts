// User Types
export interface User {
  id: string;
  address: string;
  email: string;
  onboarded_at: Date;
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

