import { query } from '../../config/database';
import { ExecutionStatus } from '../../types';

export interface PerpsExecutionRecordInput {
  nodeExecutionId: string;
  workflowExecutionId: string;
  userId: string;
  network: 'testnet' | 'mainnet';
  action: string;
  requestPayload: any;
}

export class PerpsExecutionService {
  async create(input: PerpsExecutionRecordInput): Promise<string> {
    const result = await query(
      `
      INSERT INTO perps_executions (
        node_execution_id,
        workflow_execution_id,
        user_id,
        network,
        action,
        status,
        request_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
      `,
      [
        input.nodeExecutionId,
        input.workflowExecutionId,
        input.userId,
        input.network,
        input.action,
        ExecutionStatus.PENDING,
        JSON.stringify(input.requestPayload),
      ],
    );

    return result.rows[0].id;
  }

  async complete(
    executionId: string,
    params: {
      success: boolean;
      responsePayload?: any;
      txHash?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<void> {
    await query(
      `
      UPDATE perps_executions
      SET status = $1,
          response_payload = $2,
          tx_hash = $3,
          error_code = $4,
          error_message = $5,
          updated_at = NOW()
      WHERE id = $6;
      `,
      [
        params.success ? ExecutionStatus.SUCCESS : ExecutionStatus.FAILED,
        params.responsePayload ? JSON.stringify(params.responsePayload) : null,
        params.txHash || null,
        params.errorCode || null,
        params.errorMessage || null,
        executionId,
      ],
    );
  }
}

export const perpsExecutionService = new PerpsExecutionService();
