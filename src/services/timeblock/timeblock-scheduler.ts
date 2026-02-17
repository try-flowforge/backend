import { QueueName, getQueue } from '../../config/queues';
import { logger } from '../../utils/logger';

export type TimeBlockSchedule = {
  id: string;
  workflowId: string;
  userId: string;
  runAt: Date;
  recurrenceType: 'NONE' | 'INTERVAL' | 'CRON';
  intervalSeconds?: number | null;
  cronExpression?: string | null;
  timezone?: string | null;
  untilAt?: Date | null;
};

export async function scheduleTimeBlockJob(schedule: TimeBlockSchedule): Promise<void> {
  const queue = getQueue(QueueName.WORKFLOW_TRIGGER);

  const jobId = `timeblock:${schedule.id}`;
  const name = jobId;

  const baseData = {
    workflowId: schedule.workflowId,
    userId: schedule.userId,
    triggeredBy: 'TIME_BLOCK',
    timeBlockId: schedule.id,
  };

  if (schedule.recurrenceType === 'NONE') {
    const delayMs = Math.max(0, schedule.runAt.getTime() - Date.now());

    logger.info({ timeBlockId: schedule.id, delayMs }, 'Scheduling one-time time block job');

    await queue.add(name, baseData, { jobId, delay: delayMs });
    return;
  }

  if (schedule.recurrenceType === 'INTERVAL') {
    const everyMs = (schedule.intervalSeconds || 0) * 1000;
    const startDate = schedule.runAt;

    logger.info(
      { timeBlockId: schedule.id, everyMs, startDate, endDate: schedule.untilAt },
      'Scheduling interval time block job'
    );

    await queue.add(name, baseData, {
      jobId,
      repeat: {
        every: everyMs,
        startDate,
        endDate: schedule.untilAt || undefined,
      },
    });
    return;
  }

  // CRON
  logger.info(
    {
      timeBlockId: schedule.id,
      cronExpression: schedule.cronExpression,
      tz: schedule.timezone,
      endDate: schedule.untilAt,
    },
    'Scheduling cron time block job'
  );

  await queue.add(name, baseData, {
    jobId,
    repeat: {
      pattern: schedule.cronExpression as string,
      tz: schedule.timezone || undefined,
      endDate: schedule.untilAt || undefined,
    },
  });
}

export async function cancelTimeBlockJob(timeBlockId: string): Promise<void> {
  const queue = getQueue(QueueName.WORKFLOW_TRIGGER);

  const jobId = `timeblock:${timeBlockId}`;
  const job = await queue.getJob(jobId);
  if (job) {
    await job.remove();
  }

  // If repeatable, also remove by key when possible.
  // BullMQ sets repeatJobKey when the job is repeatable.
  const repeatKey = (job as any)?.repeatJobKey as string | undefined;
  if (repeatKey) {
    try {
      await (queue as any).removeRepeatableByKey(repeatKey);
    } catch (_e) {
      // ignore
    }
  }
}

