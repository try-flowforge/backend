import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { logger } from '../../../utils/logger';

/**
 * Time Block Node Processor
 *
 * TIME_BLOCK is a scheduling node: it defines when a workflow can be triggered
 * (runAt, recurrence, etc.). During workflow execution it acts as a passthrough—
 * the actual scheduling is handled by the time-block scheduler when the user
 * activates the schedule. When the engine reaches this node, we just pass
 * input data through to downstream nodes.
 */
export class TimeBlockNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.TIME_BLOCK;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, 'Executing Time Block node (passthrough)');

    try {
      const output = {
        ...input.inputData,
        triggeredAt: input.executionContext.triggeredAt,
        triggeredBy: input.executionContext.triggeredBy,
        workflowId: input.executionContext.workflowId,
        executionId: input.executionContext.executionId,
      };

      const endTime = new Date();

      logger.info(
        { nodeId: input.nodeId, executionId: input.executionContext.executionId },
        'Time Block node executed successfully (passthrough)'
      );

      return {
        nodeId: input.nodeId,
        success: true,
        output,
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    } catch (error) {
      const endTime = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(
        { nodeId: input.nodeId, error: errorMessage },
        'Time Block node execution failed'
      );

      return {
        nodeId: input.nodeId,
        success: false,
        output: null,
        error: {
          message: errorMessage,
          code: 'TIME_BLOCK_NODE_EXECUTION_FAILED',
        },
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    }
  }

  async validate(_config: any): Promise<{ valid: boolean; errors?: string[] }> {
    // Config validation is done by the workflow schema and time-block API
    return { valid: true };
  }
}
