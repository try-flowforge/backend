import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { logger } from '../../../utils/logger';
import { enqueueLLMExecution, QueueName, getQueueEvents } from '../../../config/queues';
import type { LLMExecutionJobData } from '../../../config/queues';
import { templateString } from '../../../utils/template-engine';
import crypto from 'crypto';

/**
 * LLM Transform Node Configuration
 */
export interface LlmTransformNodeConfig {
  provider: 'openai' | 'openrouter';
  model: string;
  userPromptTemplate: string; // Supports {{path}} templating
  outputSchema?: Record<string, any>;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * LLM Transform Node Processor
 * Handles execution of LLM-based transformation nodes in workflows
 * 
 * Uses the LLM BullMQ queue to execute LLM calls via the llm-service microservice.
 * Supports {{path}} templating in prompts to reference upstream node outputs.
 */
export class LlmTransformNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.LLM_TRANSFORM;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, 'Executing LLM Transform node');

    try {
      const config: LlmTransformNodeConfig = input.nodeConfig;

      // Validate configuration
      const validation = await this.validate(config);
      if (!validation.valid) {
        throw new Error(`Invalid LLM Transform configuration: ${validation.errors?.join(', ')}`);
      }

      // Build messages array
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

      // Log input data for debugging
      logger.debug(
        {
          nodeId: input.nodeId,
          inputDataKeys: Object.keys(input.inputData || {}),
          inputData: input.inputData,
        },
        'LLM Transform input data'
      );

      // Template the user prompt with input data
      const userPrompt = templateString(config.userPromptTemplate, input.inputData);
      
      logger.debug(
        {
          nodeId: input.nodeId,
          originalTemplate: config.userPromptTemplate,
          templatedPrompt: userPrompt,
        },
        'LLM prompt templating'
      );
      
      messages.push({
        role: 'user',
        content: userPrompt,
      });

      // Generate request ID
      const requestId = `llm-${input.nodeId}-${crypto.randomUUID()}`;

      // Enqueue LLM job
      const jobData: LLMExecutionJobData = {
        userId: input.executionContext.userId,
        provider: config.provider,
        model: config.model,
        messages,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        responseSchema: config.outputSchema,
        requestId,
      };

      logger.info({
        nodeId: input.nodeId,
        requestId,
        provider: config.provider,
        model: config.model,
      }, 'Enqueueing LLM job');

      const job = await enqueueLLMExecution(jobData);

      // Wait for job completion with timeout
      logger.debug({
        nodeId: input.nodeId,
        requestId,
        jobId: job.id,
      }, 'Waiting for LLM job to complete');

      // waitUntilFinished requires QueueEvents and optional timeout
      const result = await job.waitUntilFinished(getQueueEvents(QueueName.LLM_EXECUTION), 200000);

      const endTime = new Date();

      logger.info({
        nodeId: input.nodeId,
        requestId,
        usage: result.usage,
      }, 'LLM Transform node completed');

      // Debug: Log the output structure
      logger.info({
        nodeId: input.nodeId,
        outputKeys: Object.keys(result),
        text: result.text?.substring(0, 200) + (result.text?.length > 200 ? '...' : ''),
        json: result.json,
        hasJsonData: result.json && Object.keys(result.json).length > 0,
      }, 'LLM Transform node output (debug)');

      // Return output
      return {
        nodeId: input.nodeId,
        success: true,
        output: {
          text: result.text,
          json: result.json || {},
          usage: result.usage,
          model: result.model,
          providerRequestId: result.providerRequestId,
        },
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    } catch (error) {
      const endTime = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error({
        nodeId: input.nodeId,
        error: errorMessage,
      }, 'LLM Transform node execution failed');

      return {
        nodeId: input.nodeId,
        success: false,
        output: {
          error: errorMessage,
        },
        error: {
          message: errorMessage,
          code: 'LLM_TRANSFORM_NODE_EXECUTION_FAILED',
        },
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    }
  }


  async validate(config: any): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    // Validate provider
    if (!config.provider) {
      errors.push('Provider is required');
    } else if (!['openai', 'openrouter'].includes(config.provider)) {
      errors.push('Provider must be "openai" or "openrouter"');
    }

    // Validate model
    if (!config.model || typeof config.model !== 'string') {
      errors.push('Model is required and must be a string');
    }

    // Validate user prompt template
    if (!config.userPromptTemplate || typeof config.userPromptTemplate !== 'string') {
      errors.push('User prompt template is required and must be a string');
    } else if (config.userPromptTemplate.trim().length === 0) {
      errors.push('User prompt template cannot be empty');
    }

    // Validate temperature if provided
    if (config.temperature !== undefined) {
      if (typeof config.temperature !== 'number') {
        errors.push('Temperature must be a number');
      } else if (config.temperature < 0 || config.temperature > 2) {
        errors.push('Temperature must be between 0 and 2');
      }
    }

    // Validate max output tokens if provided
    if (config.maxOutputTokens !== undefined) {
      if (typeof config.maxOutputTokens !== 'number' || config.maxOutputTokens < 1) {
        errors.push('Max output tokens must be a positive number');
      }
    }

    // Validate output schema if provided
    if (config.outputSchema !== undefined) {
      if (typeof config.outputSchema !== 'object' || config.outputSchema === null) {
        errors.push('Output schema must be an object');
      }
    }

    if (errors.length > 0) {
      logger.warn(
        { errors, config },
        'LLM Transform node configuration validation failed'
      );
      return { valid: false, errors };
    }

    return { valid: true };
  }
}
