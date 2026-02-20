export enum TimeBlockStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export enum TimeBlockRecurrenceType {
  NONE = 'NONE',
  INTERVAL = 'INTERVAL',
  CRON = 'CRON',
}

export interface DBTimeBlock {
  id: string;
  user_id: string;
  workflow_id: string;
  run_at: Date;
  timezone?: string | null;
  recurrence_type: TimeBlockRecurrenceType;
  interval_seconds?: number | null;
  cron_expression?: string | null;
  until_at?: Date | null;
  max_runs?: number | null;
  run_count: number;
  status: TimeBlockStatus;
  created_at: Date;
  updated_at: Date;
  cancelled_at?: Date | null;
  completed_at?: Date | null;
}

export interface CreateTimeBlockInput {
  workflowId: string;
  runAt: string; // ISO
  timezone?: string;
  recurrence?: {
    type: TimeBlockRecurrenceType;
    intervalSeconds?: number;
    cronExpression?: string;
    untilAt?: string;
    maxRuns?: number;
  };
}

