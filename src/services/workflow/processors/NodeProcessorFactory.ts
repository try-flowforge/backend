import { NodeType } from '../../../types';
import { INodeProcessor, INodeProcessorFactory } from '../interfaces/INodeProcessor';
import { SwapNodeProcessor } from './SwapNodeProcessor';
import { EmailNodeProcessor } from './EmailNodeProcessor';
import { IfNodeProcessor } from './IfNodeProcessor';
import { SwitchNodeProcessor } from './SwitchNodeProcessor';
import { LendingNodeProcessor } from './LendingNodeProcessor';
import { SlackNodeProcessor } from './SlackNodeProcessor';
import { TelegramNodeProcessor } from './TelegramNodeProcessor';
import { StartNodeProcessor } from './StartNodeProcessor';
import { WalletNodeProcessor } from './WalletNodeProcessor';
import { OracleNodeProcessor } from './OracleNodeProcessor';
import { PythOracleNodeProcessor } from './PythOracleNodeProcessor';
import { LlmTransformNodeProcessor } from './LlmTransformNodeProcessor';
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

      // Register email processor
      this.registerProcessor(new EmailNodeProcessor());

      // Register IF processor
      this.registerProcessor(new IfNodeProcessor());

      // Register SWITCH processor
      this.registerProcessor(new SwitchNodeProcessor());
      // Register lending processor
      this.registerProcessor(new LendingNodeProcessor());

      // Register Slack processor
      this.registerProcessor(new SlackNodeProcessor());

      // Register Telegram processor
      this.registerProcessor(new TelegramNodeProcessor());

      // Register Start node processor
      this.registerProcessor(new StartNodeProcessor());

      // Register Wallet processor
      this.registerProcessor(new WalletNodeProcessor());

      // Register Chainlink Price Oracle processor
      this.registerProcessor(new OracleNodeProcessor());

      // Register Pyth Price Oracle processor
      this.registerProcessor(new PythOracleNodeProcessor());

      // Register LLM Transform processor
      this.registerProcessor(new LlmTransformNodeProcessor());

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

