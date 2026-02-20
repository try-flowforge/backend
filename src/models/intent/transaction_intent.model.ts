import { z } from "zod";

export interface TransactionIntent {
    id: string; // UUID
    userId: string;
    agentUserId: string;
    safeAddress: string;
    chainId: number;

    // Raw calldata (single call or multicall-encoded)
    to: string;
    value: string;
    data: string;
    description: string | null;

    // Pre-computed Safe transaction fields (set when intent is built server-side)
    safeTxHash: string | null;
    safeTxData: {
        to: string;
        value: string;   // bigint serialised as string
        data: string;
        operation: number; // 0 = CALL, 1 = DELEGATECALL
    } | null;

    status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
    txHash: string | null;

    createdAt: Date;
    updatedAt: Date;
}

// ---- Schemas for API validation ----

/** Legacy: agent sends raw calldata (placeholder values allowed) */
export const createTransactionIntentSchema = z.object({
    userId: z.string(),
    agentUserId: z.string(),
    safeAddress: z.string(),
    chainId: z.number(),
    to: z.string(),
    value: z.string(),
    data: z.string(),
    description: z.string().optional(),
});

export type CreateTransactionIntentInput = z.infer<typeof createTransactionIntentSchema>;

/** New: agent sends structured workflow steps; backend builds the calldata */
export const buildTransactionIntentSchema = z.object({
    userId: z.string(),
    agentUserId: z.string(),
    safeAddress: z.string(),
    chainId: z.number(),
    description: z.string().optional(),
    steps: z.array(
        z.object({
            blockType: z.enum(['swap', 'lending']),
            configHints: z.record(z.union([z.string(), z.number()])),
        })
    ).min(1),
});

export type BuildTransactionIntentInput = z.infer<typeof buildTransactionIntentSchema>;

/** Used by completeIntent - now accepts a signature instead of txHash */
export const completeTransactionIntentSchema = z.object({
    signature: z.string().min(1),
});

export type CompleteTransactionIntentInput = z.infer<typeof completeTransactionIntentSchema>;
