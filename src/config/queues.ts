import { Queue, QueueEvents, Job, QueueOptions } from 'bullmq';
import { logger } from '../utils/logger';
import { QUEUE_CONSTANTS } from './constants';

// Queue Names
export enum QueueName {
  WORKFLOW_EXECUTION = 'workflow-execution',
  NODE_EXECUTION = 'node-execution',
  SWAP_EXECUTION = 'swap-execution',
  WORKFLOW_TRIGGER = 'workflow-trigger',
  LLM = 'llm', // LLM execution queue
}

// Job Data Types
export interface WorkflowExecutionJobData {
  workflowId: string;
  userId: string;
  triggeredBy: string;
  initialInput?: Record<string, any>;
  executionId?: string;
  versionNumber?: number;
}

export interface NodeExecutionJobData {
  executionId: string;
  nodeId: string;
  nodeType: string;
  nodeConfig: any;
  inputData: any;
  userId: string;
  workflowId: string;
}

export interface SwapExecutionJobData {
  nodeExecutionId: string;
  executionId: string;
  provider: string;
  chain: string;
  inputConfig: any;
  userId: string;
  walletAddress: string;
}

export interface LLMExecutionJobData {
  userId: string;
  provider: string; // 'openai' | 'openrouter'
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxOutputTokens?: number;
  responseSchema?: Record<string, any>;
  requestId: string;
}

// Queue Configuration - using centralized constants
const defaultQueueOptions: QueueOptions = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
  },
  defaultJobOptions: {
    removeOnComplete: {
      count: QUEUE_CONSTANTS.MAX_COMPLETED_JOBS_RETENTION,
      age: QUEUE_CONSTANTS.COMPLETED_JOBS_RETENTION_HOURS * 3600,
    },
    removeOnFail: {
      count: QUEUE_CONSTANTS.MAX_FAILED_JOBS_RETENTION,
      age: QUEUE_CONSTANTS.FAILED_JOBS_RETENTION_DAYS * 24 * 3600,
    },
    attempts: QUEUE_CONSTANTS.DEFAULT_RETRY_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: QUEUE_CONSTANTS.RETRY_BACKOFF_DELAY_MS,
    },
  },
};

// Worker Configuration (used by workers, not here)
// Defined in workers/index.ts

// Queue Instances
let workflowExecutionQueue: Queue<WorkflowExecutionJobData>;
let nodeExecutionQueue: Queue<NodeExecutionJobData>;
let swapExecutionQueue: Queue<SwapExecutionJobData>;
let workflowTriggerQueue: Queue<WorkflowExecutionJobData>;
let llmQueue: Queue<LLMExecutionJobData>;

// Queue Events
let workflowExecutionEvents: QueueEvents;
let nodeExecutionEvents: QueueEvents;
let swapExecutionEvents: QueueEvents;
let llmEvents: QueueEvents;

/**
 * Initialize all queues
 */
export const initializeQueues = async (): Promise<void> => {
  logger.info('Initializing BullMQ queues...');

  try {
    // Workflow Execution Queue
    workflowExecutionQueue = new Queue(
      QueueName.WORKFLOW_EXECUTION,
      {
        ...defaultQueueOptions,
        defaultJobOptions: {
          ...defaultQueueOptions.defaultJobOptions,
          attempts: 2, // Workflows get 2 attempts
        },
      }
    ) as any;

    // Node Execution Queue
    nodeExecutionQueue = new Queue(
      QueueName.NODE_EXECUTION,
      {
        ...defaultQueueOptions,
        defaultJobOptions: {
          ...defaultQueueOptions.defaultJobOptions,
          attempts: 3, // Nodes get 3 attempts
        },
      }
    ) as any;

    // Swap Execution Queue
    swapExecutionQueue = new Queue(
      QueueName.SWAP_EXECUTION,
      {
        ...defaultQueueOptions,
        defaultJobOptions: {
          ...defaultQueueOptions.defaultJobOptions,
          attempts: 3, // Swaps get 3 attempts
        },
      }
    ) as any;

    // Workflow Trigger Queue (for scheduled/cron triggers)
    workflowTriggerQueue = new Queue(
      QueueName.WORKFLOW_TRIGGER,
      defaultQueueOptions
    ) as any;

    // LLM Execution Queue (dedicated for LLM calls)
    llmQueue = new Queue(
      QueueName.LLM,
      {
        ...defaultQueueOptions,
        defaultJobOptions: {
          ...defaultQueueOptions.defaultJobOptions,
          attempts: 2, // LLM calls get 2 attempts (provider retries are handled by llm-service)
        },
      }
    ) as any;

    // Initialize Queue Events
    workflowExecutionEvents = new QueueEvents(QueueName.WORKFLOW_EXECUTION, {
      connection: defaultQueueOptions.connection,
    });

    nodeExecutionEvents = new QueueEvents(QueueName.NODE_EXECUTION, {
      connection: defaultQueueOptions.connection,
    });

    swapExecutionEvents = new QueueEvents(QueueName.SWAP_EXECUTION, {
      connection: defaultQueueOptions.connection,
    });

    llmEvents = new QueueEvents(QueueName.LLM, {
      connection: defaultQueueOptions.connection,
    });

    // Setup event listeners
    setupQueueEventListeners();

    logger.info('BullMQ queues initialized successfully');
  } catch (error) {
    logger.error({ error, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, 'Failed to initialize BullMQ queues');
    throw error;
  }
};

/**
 * Setup event listeners for queue monitoring
 */
const setupQueueEventListeners = () => {
  // Workflow Execution Events
  workflowExecutionEvents.on('completed', ({ jobId }) => {
    logger.info({ jobId, queue: QueueName.WORKFLOW_EXECUTION }, 'Job completed');
  });

  workflowExecutionEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(
      { jobId, queue: QueueName.WORKFLOW_EXECUTION, failedReason },
      'Job failed'
    );
  });

  // Node Execution Events
  nodeExecutionEvents.on('completed', ({ jobId }) => {
    logger.debug({ jobId, queue: QueueName.NODE_EXECUTION }, 'Job completed');
  });

  nodeExecutionEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(
      { jobId, queue: QueueName.NODE_EXECUTION, failedReason },
      'Job failed'
    );
  });

  // Swap Execution Events
  swapExecutionEvents.on('completed', ({ jobId }) => {
    logger.info({ jobId, queue: QueueName.SWAP_EXECUTION }, 'Swap completed');
  });

  swapExecutionEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(
      { jobId, queue: QueueName.SWAP_EXECUTION, failedReason },
      'Swap failed'
    );
  });

  // LLM Execution Events
  llmEvents.on('completed', ({ jobId }) => {
    logger.info({ jobId, queue: QueueName.LLM }, 'LLM request completed');
  });

  llmEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(
      { jobId, queue: QueueName.LLM, failedReason },
      'LLM request failed'
    );
  });
};

/**
 * Get queue instance
 */
export const getQueue = <T = any>(queueName: QueueName): Queue<T> => {
  switch (queueName) {
    case QueueName.WORKFLOW_EXECUTION:
      return workflowExecutionQueue as unknown as Queue<T>;
    case QueueName.NODE_EXECUTION:
      return nodeExecutionQueue as unknown as Queue<T>;
    case QueueName.SWAP_EXECUTION:
      return swapExecutionQueue as unknown as Queue<T>;
    case QueueName.WORKFLOW_TRIGGER:
      return workflowTriggerQueue as unknown as Queue<T>;
    case QueueName.LLM:
      return llmQueue as unknown as Queue<T>;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
};

/**
 * Get queue events instance
 */
export const getQueueEvents = (queueName: QueueName): QueueEvents => {
  switch (queueName) {
    case QueueName.WORKFLOW_EXECUTION:
      return workflowExecutionEvents;
    case QueueName.NODE_EXECUTION:
      return nodeExecutionEvents;
    case QueueName.SWAP_EXECUTION:
      return swapExecutionEvents;
    case QueueName.WORKFLOW_TRIGGER:
      throw new Error('Workflow trigger queue does not have events');
    case QueueName.LLM:
      return llmEvents;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
};

/**
 * Add job to workflow execution queue
 */
export const enqueueWorkflowExecution = async (
  data: WorkflowExecutionJobData
): Promise<Job<WorkflowExecutionJobData>> => {
  logger.info(
    { workflowId: data.workflowId, userId: data.userId },
    'Enqueueing workflow execution'
  );

  return await workflowExecutionQueue.add(
    `workflow:${data.workflowId}`,
    data,
    {
      jobId: data.executionId,
    }
  );
};

/**
 * Add job to node execution queue
 */
export const enqueueNodeExecution = async (
  data: NodeExecutionJobData
): Promise<Job<NodeExecutionJobData>> => {
  logger.debug(
    { nodeId: data.nodeId, executionId: data.executionId },
    'Enqueueing node execution'
  );

  return await nodeExecutionQueue.add(
    `node:${data.nodeId}`,
    data
  );
};

/**
 * Add job to swap execution queue
 */
export const enqueueSwapExecution = async (
  data: SwapExecutionJobData
): Promise<Job<SwapExecutionJobData>> => {
  logger.info(
    {
      provider: data.provider,
      chain: data.chain,
      executionId: data.executionId
    },
    'Enqueueing swap execution'
  );

  return await swapExecutionQueue.add(
    `swap:${data.nodeExecutionId}`,
    data,
    {
      priority: 1, // High priority for swaps
    }
  );
};

/**
 * Add job to LLM execution queue
 */
export const enqueueLLMExecution = async (
  data: LLMExecutionJobData
): Promise<Job<LLMExecutionJobData>> => {
  logger.info(
    {
      provider: data.provider,
      model: data.model,
      userId: data.userId,
      requestId: data.requestId,
    },
    'Enqueueing LLM execution'
  );

  return await llmQueue.add(
    `llm:${data.requestId}`,
    data,
    {
      jobId: data.requestId,
    }
  );
};

/**
 * Schedule recurring workflow trigger
 */
export const scheduleWorkflowTrigger = async (
  workflowId: string,
  userId: string,
  cronExpression: string
): Promise<void> => {
  logger.info(
    { workflowId, cronExpression },
    'Scheduling workflow trigger'
  );

  await workflowTriggerQueue.add(
    `trigger:${workflowId}`,
    {
      workflowId,
      userId,
      triggeredBy: 'CRON',
    },
    {
      repeat: {
        pattern: cronExpression,
      },
      jobId: `cron:${workflowId}`,
    }
  );
};

/**
 * Remove scheduled workflow trigger
 */
export const removeWorkflowTrigger = async (workflowId: string): Promise<void> => {
  logger.info({ workflowId }, 'Removing workflow trigger');

  const jobId = `cron:${workflowId}`;
  const job = await workflowTriggerQueue.getJob(jobId);

  if (job) {
    await job.remove();
  }
};

/**
 * Get job status
 */
export const getJobStatus = async (
  queueName: QueueName,
  jobId: string
): Promise<any> => {
  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  const state = await job.getState();

  return {
    id: job.id,
    name: job.name,
    data: job.data,
    state,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    finishedOn: job.finishedOn,
    processedOn: job.processedOn,
  };
};

/**
 * Get queue metrics
 */
export const getQueueMetrics = async (queueName: QueueName) => {
  const queue = getQueue(queueName);

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    queueName,
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed,
  };
};

/**
 * Pause queue
 */
export const pauseQueue = async (queueName: QueueName): Promise<void> => {
  const queue = getQueue(queueName);
  await queue.pause();
  logger.info({ queueName }, 'Queue paused');
};

/**
 * Resume queue
 */
export const resumeQueue = async (queueName: QueueName): Promise<void> => {
  const queue = getQueue(queueName);
  await queue.resume();
  logger.info({ queueName }, 'Queue resumed');
};

/**
 * Clear queue (remove all jobs)
 */
export const clearQueue = async (queueName: QueueName): Promise<void> => {
  const queue = getQueue(queueName);
  await queue.drain();
  logger.info({ queueName }, 'Queue cleared');
};

/**
 * Gracefully close all queues
 */
export const closeQueues = async (): Promise<void> => {
  logger.info('Closing BullMQ queues...');

  try {
    await Promise.all([
      workflowExecutionQueue?.close(),
      nodeExecutionQueue?.close(),
      swapExecutionQueue?.close(),
      workflowTriggerQueue?.close(),
      llmQueue?.close(),
      workflowExecutionEvents?.close(),
      nodeExecutionEvents?.close(),
      swapExecutionEvents?.close(),
      llmEvents?.close(),
    ]);

    logger.info('BullMQ queues closed successfully');
  } catch (error) {
    logger.error({ error }, 'Error closing BullMQ queues');
    throw error;
  }
};

