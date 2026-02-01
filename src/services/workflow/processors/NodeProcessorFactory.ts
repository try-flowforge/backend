import { NodeType } from '../../../types';
import { INodeProcessor, INodeProcessorFactory } from '../interfaces/INodeProcessor';
import { SwapNodeProcessor } from './SwapNodeProcessor';
import { logger } from '../../../utils/logger';

/**
 * Factory for creating and managing node processors
 */
export class NodeProcessorFactory implements INodeProcessorFactory {
  private processors: Map<NodeType, INodeProcessor>;

  constructor() {
    this.processors = new Map();
    this.initializeProcessors();
  }

  /**
   * Initialize all available processors
   */
  private initializeProcessors(): void {
    logger.info('Initializing node processors...');

    try {
      // Register swap processor
      this.registerProcessor(new SwapNodeProcessor());

      // TODO: Add other processors as needed
      // this.registerProcessor(new TriggerNodeProcessor());
      // this.registerProcessor(new ConditionNodeProcessor());
      // this.registerProcessor(new WebhookNodeProcessor());

      logger.info(
        { processorCount: this.processors.size },
        'Node processors initialized'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to initialize node processors');
      throw error;
    }
  }

  /**
   * Get processor for a specific node type
   */
  getProcessor(nodeType: NodeType): INodeProcessor {
    const processor = this.processors.get(nodeType);

    if (!processor) {
      throw new Error(`No processor found for node type: ${nodeType}`);
    }

    return processor;
  }

  /**
   * Register a new processor
   */
  registerProcessor(processor: INodeProcessor): void {
    const nodeType = processor.getNodeType();

    if (this.processors.has(nodeType)) {
      logger.warn({ nodeType }, 'Overwriting existing processor');
    }

    this.processors.set(nodeType, processor);
    logger.debug({ nodeType }, 'Processor registered');
  }

  /**
   * Check if processor exists for node type
   */
  hasProcessor(nodeType: NodeType): boolean {
    return this.processors.has(nodeType);
  }

  /**
   * Get all registered processors
   */
  getAllProcessors(): INodeProcessor[] {
    return Array.from(this.processors.values());
  }
}

// Export singleton instance
export const nodeProcessorFactory = new NodeProcessorFactory();

