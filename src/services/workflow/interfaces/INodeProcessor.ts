import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
} from '../../../types';

/**
 * Base interface for all node processors
 */
export interface INodeProcessor {
  /**
   * Get the node type this processor handles
   */
  getNodeType(): NodeType;

  /**
   * Execute the node
   */
  execute(input: NodeExecutionInput): Promise<NodeExecutionOutput>;

  /**
   * Validate node configuration
   */
  validate(config: any): Promise<{ valid: boolean; errors?: string[] }>;
}

/**
 * Node Processor Factory
 * Returns the appropriate processor for a given node type
 */
export interface INodeProcessorFactory {
  getProcessor(nodeType: NodeType): INodeProcessor;
  registerProcessor(processor: INodeProcessor): void;
}

