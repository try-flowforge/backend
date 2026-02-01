import { Worker, Job } from 'bullmq';
import {
  QueueName,
  WorkflowExecutionJobData,
  NodeExecutionJobData,
  SwapExecutionJobData,
} from '../../config/queues';
import { workflowExecutionEngine } from '../workflow/WorkflowExecutionEngine';
import { nodeProcessorFactory } from '../workflow/processors/NodeProcessorFactory';
import { swapExecutionService } from '../swap/SwapExecutionService';
import { logger } from '../../utils/logger';

// Worker Configuration
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
};

const defaultWorkerOptions = {
  connection: redisConnection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
  limiter: {
    max: 100,
    duration: 1000, // 100 jobs per second max
  },
};
import { ExecutionStatus, TriggerType } from '../../types';

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
        concurrency: parseInt(process.env.WORKFLOW_WORKER_CONCURRENCY || '3'),
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
        initialInput
      );

      if (context.status === ExecutionStatus.FAILED) {
        throw new Error(context.error?.message || 'Workflow execution failed');
      }

      return {
        executionId: context.executionId,
        status: context.status,
        nodeOutputs: Array.from(context.nodeOutputs.entries()),
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
      // TODO: Load wallet private key from secure storage
      const privateKey = process.env.WALLET_PRIVATE_KEY || '';

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
 * Initialize all workers
 */
export const initializeWorkers = (): {
  workflowWorker: WorkflowExecutionWorker;
  nodeWorker: NodeExecutionWorker;
  swapWorker: SwapExecutionWorker;
} => {
  logger.info('Initializing BullMQ workers...');

  const workflowWorker = new WorkflowExecutionWorker();
  const nodeWorker = new NodeExecutionWorker();
  const swapWorker = new SwapExecutionWorker();

  logger.info('BullMQ workers initialized');

  return {
    workflowWorker,
    nodeWorker,
    swapWorker,
  };
};

/**
 * Close all workers gracefully
 */
export const closeWorkers = async (workers: {
  workflowWorker: WorkflowExecutionWorker;
  nodeWorker: NodeExecutionWorker;
  swapWorker: SwapExecutionWorker;
}): Promise<void> => {
  logger.info('Closing BullMQ workers...');

  await Promise.all([
    workers.workflowWorker.close(),
    workers.nodeWorker.close(),
    workers.swapWorker.close(),
  ]);

  logger.info('BullMQ workers closed');
};

