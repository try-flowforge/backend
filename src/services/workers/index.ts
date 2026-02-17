import { Worker, Job } from 'bullmq';
import {
  QueueName,
  WorkflowExecutionJobData,
  NodeExecutionJobData,
  SwapExecutionJobData,
  LLMExecutionJobData,
  enqueueWorkflowExecution,
  getQueue,
} from '../../config/queues';
import { workflowExecutionEngine } from '../workflow/WorkflowExecutionEngine';
import { nodeProcessorFactory } from '../workflow/processors/NodeProcessorFactory';
import { swapExecutionService } from '../swap/SwapExecutionService';
import { logger } from '../../utils/logger';
import { ExecutionStatus, TriggerType } from '../../types';
import { pool } from '../../config/database';
import { TimeBlockStatus } from '../../types/timeblock.types';

// Worker Configuration
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
};

const defaultWorkerOptions = {
  connection: redisConnection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '10'),
  limiter: {
    max: 200,
    duration: 1000, // 200 jobs per second max
  },
};

/**
 * Workflow Execution Worker
 * Processes workflow execution jobs
 */
export class WorkflowExecutionWorker {
  private worker: Worker<WorkflowExecutionJobData>;

  constructor() {
    this.worker = new Worker<WorkflowExecutionJobData>(
      QueueName.WORKFLOW_EXECUTION,
      async (job: Job<WorkflowExecutionJobData>) => {
        return await this.processJob(job);
      },
      {
        ...defaultWorkerOptions,
        connection: redisConnection,
        concurrency: parseInt(process.env.WORKFLOW_WORKER_CONCURRENCY || '1'),
      }
    );

    this.setupEventListeners();
  }

  private async processJob(job: Job<WorkflowExecutionJobData>): Promise<any> {
    const { workflowId, userId, triggeredBy, initialInput } = job.data;

    logger.info(
      { jobId: job.id, workflowId, userId },
      'Processing workflow execution job'
    );

    try {
      const context = await workflowExecutionEngine.executeWorkflow(
        workflowId,
        userId,
        triggeredBy as TriggerType,
        initialInput,
        job.data.executionId || job.id as string // Use execution ID from job data or job ID as fallback
      );

      if (context.status === ExecutionStatus.FAILED) {
        throw new Error(context.error?.message || 'Workflow execution failed');
      }

      // Convert node outputs to a format that can be serialized (handle BigInt)
      const nodeOutputs = Array.from(context.nodeOutputs.entries()).map(([key, value]) => {
        return [key, JSON.parse(JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? v.toString() : v))];
      });

      return {
        executionId: context.executionId,
        status: context.status,
        nodeOutputs,
      };
    } catch (error) {
      logger.error(
        { error, jobId: job.id, workflowId },
        'Workflow execution job failed'
      );
      throw error;
    }
  }

  private setupEventListeners(): void {
    this.worker.on('completed', (job) => {
      logger.info(
        { jobId: job.id, workflowId: job.data.workflowId },
        'Workflow execution completed'
      );
    });

    this.worker.on('failed', (job, error) => {
      logger.error(
        {
          jobId: job?.id,
          workflowId: job?.data.workflowId,
          error,
        },
        'Workflow execution failed'
      );
    });

    this.worker.on('error', (error) => {
      logger.error({ error }, 'Workflow execution worker error');
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}

/**
 * Node Execution Worker
 * Processes individual node execution jobs (if needed for async node execution)
 */
export class NodeExecutionWorker {
  private worker: Worker<NodeExecutionJobData>;

  constructor() {
    this.worker = new Worker<NodeExecutionJobData>(
      QueueName.NODE_EXECUTION,
      async (job: Job<NodeExecutionJobData>) => {
        return await this.processJob(job);
      },
      {
        ...defaultWorkerOptions,
        connection: redisConnection,
        concurrency: parseInt(process.env.NODE_WORKER_CONCURRENCY || '10'),
      }
    );

    this.setupEventListeners();
  }

  private async processJob(job: Job<NodeExecutionJobData>): Promise<any> {
    const { nodeId, nodeType, nodeConfig, inputData } = job.data;

    logger.debug(
      { jobId: job.id, nodeId, nodeType },
      'Processing node execution job'
    );

    try {
      const processor = nodeProcessorFactory.getProcessor(nodeType as any);

      // TODO: Load execution context and secrets
      const result = await processor.execute({
        nodeId,
        nodeType: nodeType as any,
        nodeConfig,
        inputData,
        executionContext: {} as any, // Load from DB
        secrets: {}, // Load from secrets manager
      });

      return result;
    } catch (error) {
      logger.error(
        { error, jobId: job.id, nodeId },
        'Node execution job failed'
      );
      throw error;
    }
  }

  private setupEventListeners(): void {
    this.worker.on('completed', (job) => {
      logger.debug(
        { jobId: job.id, nodeId: job.data.nodeId },
        'Node execution completed'
      );
    });

    this.worker.on('failed', (job, error) => {
      logger.error(
        {
          jobId: job?.id,
          nodeId: job?.data.nodeId,
          error,
        },
        'Node execution failed'
      );
    });

    this.worker.on('error', (error) => {
      logger.error({ error }, 'Node execution worker error');
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}

/**
 * Swap Execution Worker
 * Processes swap execution jobs (if swaps are executed async)
 */
export class SwapExecutionWorker {
  private worker: Worker<SwapExecutionJobData>;

  constructor() {
    this.worker = new Worker<SwapExecutionJobData>(
      QueueName.SWAP_EXECUTION,
      async (job: Job<SwapExecutionJobData>) => {
        return await this.processJob(job);
      },
      {
        ...defaultWorkerOptions,
        connection: redisConnection,
        concurrency: parseInt(process.env.SWAP_WORKER_CONCURRENCY || '5'),
      }
    );

    this.setupEventListeners();
  }

  private async processJob(job: Job<SwapExecutionJobData>): Promise<any> {
    const { nodeExecutionId, provider, chain, inputConfig } = job.data;

    logger.info(
      { jobId: job.id, provider, chain },
      'Processing swap execution job'
    );

    try {
      // Validate wallet private key exists
      const privateKey = process.env.WALLET_PRIVATE_KEY;

      if (!privateKey) {
        throw new Error(
          'WALLET_PRIVATE_KEY environment variable is required for swap execution. ' +
          'Please configure a wallet private key in your environment.'
        );
      }

      if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
        throw new Error(
          'Invalid WALLET_PRIVATE_KEY format. Must be a 66-character hex string starting with 0x.'
        );
      }

      const result = await swapExecutionService.executeSwap(
        nodeExecutionId,
        chain as any,
        provider as any,
        inputConfig,
        privateKey
      );

      if (!result.success) {
        throw new Error(result.errorMessage || 'Swap execution failed');
      }

      return result;
    } catch (error) {
      logger.error(
        { error, jobId: job.id, provider, chain },
        'Swap execution job failed'
      );
      throw error;
    }
  }

  private setupEventListeners(): void {
    this.worker.on('completed', (job) => {
      logger.info(
        { jobId: job.id, provider: job.data.provider },
        'Swap execution completed'
      );
    });

    this.worker.on('failed', (job, error) => {
      logger.error(
        {
          jobId: job?.id,
          provider: job?.data.provider,
          error,
        },
        'Swap execution failed'
      );
    });

    this.worker.on('error', (error) => {
      logger.error({ error }, 'Swap execution worker error');
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}

/**
 * LLM Execution Worker
 * Processes LLM execution jobs by calling the LLM microservice
 */
export class LLMExecutionWorker {
  private worker: Worker<LLMExecutionJobData>;

  constructor() {
    this.worker = new Worker<LLMExecutionJobData>(
      QueueName.LLM,
      async (job: Job<LLMExecutionJobData>) => {
        return await this.processJob(job);
      },
      {
        ...defaultWorkerOptions,
        connection: redisConnection,
        concurrency: parseInt(process.env.LLM_WORKER_CONCURRENCY || '5', 10),
      }
    );

    this.setupEventListeners();
  }

  private async processJob(job: Job<LLMExecutionJobData>): Promise<any> {
    const { userId, provider, model, messages, temperature, maxOutputTokens, responseSchema, requestId } = job.data;

    logger.info(
      { jobId: job.id, userId, provider, model, requestId },
      'Processing LLM execution job'
    );

    try {
      // Dynamic import to avoid circular dependency
      const { llmServiceClient } = await import('../llm/llm-service-client');

      const response = await llmServiceClient.chat({
        provider,
        model,
        messages,
        temperature,
        maxOutputTokens,
        responseSchema,
        requestId,
        userId,
      });

      logger.info(
        { jobId: job.id, requestId, usage: response.usage },
        'LLM execution completed'
      );

      return response;
    } catch (error) {
      logger.error(
        { error, jobId: job.id, requestId, provider, model },
        'LLM execution job failed'
      );
      throw error;
    }
  }

  private setupEventListeners(): void {
    this.worker.on('completed', (job) => {
      logger.info(
        { jobId: job.id, requestId: job.data.requestId },
        'LLM execution job completed'
      );
    });

    this.worker.on('failed', (job, error) => {
      logger.error(
        {
          jobId: job?.id,
          requestId: job?.data.requestId,
          error,
        },
        'LLM execution job failed'
      );
    });

    this.worker.on('error', (error) => {
      logger.error({ error }, 'LLM execution worker error');
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}

/**
 * Workflow Trigger Worker
 * Consumes scheduled trigger jobs (cron/time-block) and enqueues workflow executions
 */
export class WorkflowTriggerWorker {
  private worker: Worker<WorkflowExecutionJobData>;

  constructor() {
    this.worker = new Worker<WorkflowExecutionJobData>(
      QueueName.WORKFLOW_TRIGGER,
      async (job: Job<WorkflowExecutionJobData>) => {
        return await this.processJob(job);
      },
      {
        ...defaultWorkerOptions,
        connection: redisConnection,
        concurrency: parseInt(process.env.TRIGGER_WORKER_CONCURRENCY || '5'),
      }
    );

    this.setupEventListeners();
  }

  private async processJob(job: Job<WorkflowExecutionJobData>): Promise<any> {
    const { workflowId, userId, triggeredBy, timeBlockId } = job.data;

    // If this trigger is associated with a time block, enforce stop/cancel rules
    if (timeBlockId) {
      const tbRes = await pool.query(
        'SELECT id, status, run_count, max_runs, until_at FROM time_blocks WHERE id = $1',
        [timeBlockId]
      );
      if (tbRes.rows.length === 0) {
        logger.warn({ timeBlockId, jobId: job.id }, 'Time block missing, skipping trigger');
        return { skipped: true, reason: 'TIME_BLOCK_NOT_FOUND' };
      }

      const tb = tbRes.rows[0] as {
        id: string;
        status: TimeBlockStatus;
        run_count: number;
        max_runs: number | null;
        until_at: string | null;
      };

      const untilAtMs = tb.until_at ? new Date(tb.until_at).getTime() : null;
      const nowMs = Date.now();

      if (tb.status !== TimeBlockStatus.ACTIVE) {
        logger.info({ timeBlockId, status: tb.status }, 'Time block not active, skipping trigger');
        return { skipped: true, reason: 'TIME_BLOCK_NOT_ACTIVE' };
      }

      if (untilAtMs !== null && nowMs > untilAtMs) {
        await this.completeTimeBlock(timeBlockId, job);
        return { skipped: true, reason: 'TIME_BLOCK_EXPIRED' };
      }

      if (tb.max_runs !== null && tb.run_count >= tb.max_runs) {
        await this.completeTimeBlock(timeBlockId, job);
        return { skipped: true, reason: 'TIME_BLOCK_MAX_RUNS_REACHED' };
      }

      // Increment run_count (best-effort)
      await pool.query(
        'UPDATE time_blocks SET run_count = run_count + 1, updated_at = NOW() WHERE id = $1',
        [timeBlockId]
      );
    }

    // Enqueue actual workflow execution
    const executionId = job.id as string;
    await enqueueWorkflowExecution({
      workflowId,
      userId,
      triggeredBy: (triggeredBy || 'CRON') as string,
      executionId,
      initialInput: job.data.initialInput,
    });

    return { enqueued: true, executionId };
  }

  private async completeTimeBlock(timeBlockId: string, job: Job<WorkflowExecutionJobData>): Promise<void> {
    await pool.query(
      `UPDATE time_blocks
       SET status = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [timeBlockId, TimeBlockStatus.COMPLETED]
    );

    // Remove repeat schedule (if any) so it stops firing
    const queue = getQueue(QueueName.WORKFLOW_TRIGGER);
    const repeatKey = (job as any)?.repeatJobKey as string | undefined;
    if (repeatKey) {
      try {
        await (queue as any).removeRepeatableByKey(repeatKey);
      } catch (_e) {
        // ignore
      }
    }
  }

  private setupEventListeners(): void {
    this.worker.on('completed', (job) => {
      logger.debug({ jobId: job.id }, 'Trigger job processed');
    });

    this.worker.on('failed', (job, error) => {
      logger.error({ jobId: job?.id, error }, 'Trigger job failed');
    });

    this.worker.on('error', (error) => {
      logger.error({ error }, 'Workflow trigger worker error');
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}

/**
 * Initialize all workers
 */
export const initializeWorkers = (): {
  workflowWorker: WorkflowExecutionWorker;
  nodeWorker: NodeExecutionWorker;
  swapWorker: SwapExecutionWorker;
  llmWorker: LLMExecutionWorker;  
  triggerWorker: WorkflowTriggerWorker;
} => {
  logger.info('Initializing BullMQ workers...');

  const workflowWorker = new WorkflowExecutionWorker();
  const nodeWorker = new NodeExecutionWorker();
  const swapWorker = new SwapExecutionWorker();
  const llmWorker = new LLMExecutionWorker();
  const triggerWorker = new WorkflowTriggerWorker();
  logger.info('BullMQ workers initialized');

  return {
    workflowWorker,
    nodeWorker,
    swapWorker,
    llmWorker,
    triggerWorker,
  };
};

/**
 * Close all workers gracefully
 */
export const closeWorkers = async (workers: {
  workflowWorker: WorkflowExecutionWorker;
  nodeWorker: NodeExecutionWorker;
  swapWorker: SwapExecutionWorker;
  llmWorker: LLMExecutionWorker;
  triggerWorker: WorkflowTriggerWorker;
}): Promise<void> => {
  logger.info('Closing BullMQ workers...');

  await Promise.all([
    workers.workflowWorker.close(),
    workers.nodeWorker.close(),
    workers.swapWorker.close(),
    workers.llmWorker.close(),
    workers.triggerWorker.close(),
  ]);

  logger.info('BullMQ workers closed');
};
