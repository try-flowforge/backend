import {
    NodeType,
    NodeExecutionInput,
    NodeExecutionOutput,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { logger } from '../../../utils/logger';

/**
 * Start Node Processor
 * Handles execution of Start/entry-point nodes in workflows
 * 
 * This is a passthrough processor that passes the initial input
 * to the next node in the workflow.
 */
export class StartNodeProcessor implements INodeProcessor {
    getNodeType(): NodeType {
        return NodeType.START;
    }

    async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
        const startTime = new Date();
        logger.info({ nodeId: input.nodeId }, 'Executing Start node');

        try {
            // Start node is a passthrough - it just passes the initial input forward
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
                'Start node executed successfully'
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
                'Start node execution failed'
            );

            return {
                nodeId: input.nodeId,
                success: false,
                output: null,
                error: {
                    message: errorMessage,
                    code: 'START_NODE_EXECUTION_FAILED',
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
        // Start node doesn't require any configuration
        return { valid: true };
    }
}
