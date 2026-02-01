// ============================================
// SWAP TYPES - Complete Type Definitions
// ============================================

// Supported Chains
export enum SupportedChain {
  ARBITRUM = 'ARBITRUM',
  ARBITRUM_SEPOLIA = 'ARBITRUM_SEPOLIA',
}

// Supported Swap Providers
export enum SwapProvider {
  UNISWAP = 'UNISWAP',
  RELAY = 'RELAY',
  ONEINCH = 'ONEINCH',
}

// Node Types
export enum NodeType {
  TRIGGER = 'TRIGGER',
  SWAP = 'SWAP',
  CONDITION = 'CONDITION',
  WEBHOOK = 'WEBHOOK',
  DELAY = 'DELAY',
}

// Trigger Types
export enum TriggerType {
  CRON = 'CRON',
  WEBHOOK = 'WEBHOOK',
  MANUAL = 'MANUAL',
  EVENT = 'EVENT',
}

// Execution Status
export enum ExecutionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  RETRYING = 'RETRYING',
}

// Swap Type (exact in vs exact out)
export enum SwapType {
  EXACT_INPUT = 'EXACT_INPUT',
  EXACT_OUTPUT = 'EXACT_OUTPUT',
}

// Chain Configuration
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  contracts?: {
    uniswapRouter?: string;
    uniswapFactory?: string;
    weth?: string;
  };
}

// Token Information
export interface TokenInfo {
  address: string;
  symbol?: string;
  decimals?: number;
  name?: string;
}

// Swap Input Configuration
export interface SwapInputConfig {
  // Mandatory fields
  sourceToken: TokenInfo;
  destinationToken: TokenInfo;
  amount: string; // Wei/smallest unit as string to handle big numbers
  swapType: SwapType;
  walletAddress: string; // The wallet that will perform the swap
  
  // Optional fields with defaults
  slippageTolerance?: number; // Default: 0.5 (0.5%)
  deadline?: number; // Unix timestamp, default: 20 minutes from now
  
  // Gas preferences (optional)
  maxPriorityFeePerGas?: string;
  maxFeePerGas?: string;
  gasLimit?: string;
  
  // Advanced options
  recipient?: string; // If different from walletAddress
  enablePartialFill?: boolean; // For 1inch
  simulateFirst?: boolean; // Default: true - simulate before executing
}

// Swap Quote Response
export interface SwapQuote {
  provider: SwapProvider;
  chain: SupportedChain;
  sourceToken: TokenInfo;
  destinationToken: TokenInfo;
  amountIn: string;
  amountOut: string;
  estimatedAmountOut: string; // With slippage
  route?: string[]; // Token addresses in route
  priceImpact: string; // Percentage
  gasEstimate: string;
  estimatedGasCost: string; // In native token
  validUntil?: number; // Unix timestamp
  rawQuote?: any; // Provider-specific quote data
}

// Swap Transaction
export interface SwapTransaction {
  to: string;
  from: string;
  data: string;
  value: string;
  gasLimit: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  chainId: number;
}

// Swap Execution Result
export interface SwapExecutionResult {
  success: boolean;
  txHash?: string;
  fromToken: TokenInfo;
  toToken: TokenInfo;
  amountIn: string;
  amountOut?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  blockNumber?: number;
  timestamp: Date;
  status: ExecutionStatus;
  errorMessage?: string;
  errorCode?: string;
  retryCount?: number;
}

// Swap Node Definition
export interface SwapNodeConfig {
  provider: SwapProvider;
  chain: SupportedChain;
  inputConfig: SwapInputConfig;
  
  // Execution preferences
  simulateFirst?: boolean; // Default: true
  autoRetryOnFailure?: boolean; // Default: true
  maxRetries?: number; // Default: 3
  
  // Output mapping (for passing data to next nodes)
  outputMapping?: Record<string, string>;
}

// Generic Workflow Node
export interface WorkflowNodeDefinition {
  id: string;
  type: NodeType;
  name: string;
  description?: string;
  
  // Node-specific configuration
  config: SwapNodeConfig | TriggerNodeConfig | Record<string, any>;
  
  // Position in UI (for visual editor)
  position?: { x: number; y: number };
  
  // Metadata
  metadata?: {
    version?: string;
    category?: string;
    tags?: string[];
  };
}

// Trigger Node Configuration
export interface TriggerNodeConfig {
  triggerType: TriggerType;
  
  // Cron-specific
  cronExpression?: string;
  timezone?: string;
  
  // Webhook-specific
  webhookPath?: string;
  webhookMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  
  // Event-specific
  eventSource?: string;
  eventFilter?: Record<string, any>;
}

// Workflow Edge (connection between nodes)
export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  
  // Conditional routing
  condition?: {
    field: string;
    operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
    value: any;
  };
  
  // Data transformation
  dataMapping?: Record<string, string>;
}

// Complete Workflow Definition
export interface WorkflowDefinition {
  id: string;
  userId: string;
  name: string;
  description?: string;
  version: number;
  
  // Workflow structure
  nodes: WorkflowNodeDefinition[];
  edges: WorkflowEdge[];
  triggerNodeId: string;
  
  // Status
  isActive: boolean;
  isDraft: boolean;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  lastExecutedAt?: Date;
  
  // Configuration
  maxConcurrentExecutions?: number;
  timeout?: number; // Milliseconds
  
  // Tags and categorization
  tags?: string[];
  category?: string;
}

// Workflow Execution Context
export interface WorkflowExecutionContext {
  executionId: string;
  workflowId: string;
  userId: string;
  triggeredBy: TriggerType;
  triggeredAt: Date;
  
  // Initial input data (from trigger)
  initialInput?: Record<string, any>;
  
  // Accumulated output from all nodes
  nodeOutputs: Map<string, any>;
  
  // Execution state
  currentNodeId?: string;
  status: ExecutionStatus;
  
  // Error handling
  error?: {
    message: string;
    code?: string;
    nodeId?: string;
    stack?: string;
  };
  
  // Metadata
  startedAt: Date;
  completedAt?: Date;
  retryCount: number;
}

// Node Execution Input
export interface NodeExecutionInput {
  nodeId: string;
  nodeType: NodeType;
  nodeConfig: any;
  
  // Input from previous nodes
  inputData: any;
  
  // Context
  executionContext: WorkflowExecutionContext;
  
  // User credentials/secrets
  secrets: Record<string, string>;
}

// Node Execution Output
export interface NodeExecutionOutput {
  nodeId: string;
  success: boolean;
  output: any;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  metadata: {
    startedAt: Date;
    completedAt: Date;
    duration: number;
  };
}

// Database Models (matching DB schema)
export interface DBWorkflow {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  version: number;
  trigger_node_id: string;
  is_active: boolean;
  is_draft: boolean;
  max_concurrent_executions?: number;
  timeout?: number;
  tags?: string[];
  category?: string;
  created_at: Date;
  updated_at: Date;
  last_executed_at?: Date;
}

export interface DBWorkflowNode {
  id: string;
  workflow_id: string;
  type: NodeType;
  name: string;
  description?: string;
  config: any; // JSONB
  position?: any; // JSONB
  metadata?: any; // JSONB
  created_at: Date;
  updated_at: Date;
}

export interface DBWorkflowEdge {
  id: string;
  workflow_id: string;
  source_node_id: string;
  target_node_id: string;
  condition?: any; // JSONB
  data_mapping?: any; // JSONB
  created_at: Date;
}

export interface DBWorkflowExecution {
  id: string;
  workflow_id: string;
  user_id: string;
  triggered_by: TriggerType;
  triggered_at: Date;
  initial_input?: any; // JSONB
  status: ExecutionStatus;
  error?: any; // JSONB
  started_at: Date;
  completed_at?: Date;
  retry_count: number;
  metadata?: any; // JSONB
}

export interface DBNodeExecution {
  id: string;
  execution_id: string;
  node_id: string;
  node_type: NodeType;
  input_data?: any; // JSONB
  output_data?: any; // JSONB
  status: ExecutionStatus;
  error?: any; // JSONB
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;
  retry_count: number;
}

export interface DBSwapExecution {
  id: string;
  node_execution_id: string;
  provider: SwapProvider;
  chain: SupportedChain;
  wallet_address: string;
  source_token: any; // JSONB
  destination_token: any; // JSONB
  amount_in: string;
  amount_out?: string;
  tx_hash?: string;
  gas_used?: string;
  effective_gas_price?: string;
  block_number?: number;
  status: ExecutionStatus;
  error_message?: string;
  error_code?: string;
  quote_data?: any; // JSONB
  created_at: Date;
  completed_at?: Date;
}

// Wallet Management (for backend-controlled execution)
export interface ManagedWallet {
  id: string;
  user_id: string;
  address: string;
  encrypted_private_key: string; // Encrypted with KMS
  chain: SupportedChain;
  label?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Security & Rate Limiting
export interface RateLimitConfig {
  userId: string;
  action: string; // e.g., 'swap_execution', 'workflow_execution'
  maxRequests: number;
  windowMs: number;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

// Provider-specific configurations
export interface UniswapConfig {
  routerAddress: string;
  factoryAddress: string;
  quoterAddress?: string;
  v2?: boolean;
  v3?: boolean;
}

export interface RelayConfig {
  apiKey: string;
  apiUrl: string;
}

export interface OneInchConfig {
  apiKey: string;
  apiUrl: string;
}

