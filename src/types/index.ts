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
  };
}

// Workflow Types (for future use)
export interface WorkflowNode {
  id: string;
  type: string;
  params: Record<string, any>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  trigger_node_id: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Execution Types (for future use)
export interface ExecutionItem {
  json: Record<string, any>;
  binary?: Record<string, any>;
}

export interface NodeExecutionResult {
  success: boolean;
  output: ExecutionItem[] | ExecutionItem[][];
  error?: Error;
}

export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  nodeId: string;
  params: Record<string, any>;
  secrets: Record<string, string>;
  input: ExecutionItem[];
}
