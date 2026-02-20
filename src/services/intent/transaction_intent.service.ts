import { query } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';
import { TransactionIntent, CreateTransactionIntentInput } from '../../models/intent';
import { logger } from '../../utils/logger';

export interface CreateIntentFull extends CreateTransactionIntentInput {
    safeTxHash?: string;
    safeTxData?: {
        to: string;
        value: string;
        data: string;
        operation: number;
    };
}

export class TransactionIntentService {
    /**
     * Creates a new pending transaction intent.
     * Accepts optional pre-built safeTxHash and safeTxData for server-side multicall intents.
     */
    async createIntent(input: CreateIntentFull): Promise<TransactionIntent> {
        const id = uuidv4();

        if (!input.userId || !input.safeAddress || !input.to || !input.value || !input.data) {
            throw new Error("Missing required fields for transaction intent");
        }

        const result = await query(
            `INSERT INTO transaction_intents (
        id, user_id, agent_user_id, safe_address, chain_id,
        "to", value, data, description, status, safe_tx_hash, safe_tx_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
            [
                id,
                input.userId,
                input.agentUserId,
                input.safeAddress,
                input.chainId,
                input.to,
                input.value,
                input.data,
                input.description || null,
                'PENDING',
                input.safeTxHash || null,
                input.safeTxData ? JSON.stringify(input.safeTxData) : null,
            ]
        );

        return this.mapToIntent(result.rows[0]);
    }

    /**
     * Retrieves an intent by its ID.
     */
    async getIntent(id: string): Promise<TransactionIntent | null> {
        const result = await query(
            `SELECT * FROM transaction_intents WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return this.mapToIntent(result.rows[0]);
    }

    /**
     * Marks an intent as completed with the provided on-chain transaction hash.
     */
    async completeIntent(id: string, txHash: string): Promise<TransactionIntent | null> {
        const result = await query(
            `UPDATE transaction_intents
       SET status = 'COMPLETED', tx_hash = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status = 'PENDING'
       RETURNING *`,
            [txHash, id]
        );

        if (result.rows.length === 0) {
            const existing = await this.getIntent(id);
            if (!existing) return null;
            if (existing.status !== 'PENDING') {
                logger.warn({ id, status: existing.status }, "Attempted to complete a non-pending intent");
                throw new Error(`Intent cannot be completed because its status is ${existing.status}`);
            }
            return null;
        }

        return this.mapToIntent(result.rows[0]);
    }

    /**
     * Marks an intent as failed.
     */
    async failIntent(id: string): Promise<TransactionIntent | null> {
        const result = await query(
            `UPDATE transaction_intents
       SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'PENDING'
       RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) return null;
        return this.mapToIntent(result.rows[0]);
    }

    // Maps database row to TypeScript interface
    private mapToIntent(row: any): TransactionIntent {
        return {
            id: row.id,
            userId: row.user_id,
            agentUserId: row.agent_user_id,
            safeAddress: row.safe_address,
            chainId: row.chain_id,
            to: row.to,
            value: row.value,
            data: row.data,
            description: row.description,
            safeTxHash: row.safe_tx_hash || null,
            safeTxData: row.safe_tx_data || null,
            status: row.status,
            txHash: row.tx_hash,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export const transactionIntentService = new TransactionIntentService();
