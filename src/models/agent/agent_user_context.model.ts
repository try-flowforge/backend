import { query } from '../../config/database';
import { logger } from '../../utils/logger';

export type AgentContextValue = string | number | boolean | string[];

export interface AgentUserContextRow {
  user_id: string;
  context: Record<string, AgentContextValue>;
  created_at: Date;
  updated_at: Date;
}

export class AgentUserContextModel {
  static async findByUserId(userId: string): Promise<AgentUserContextRow | null> {
    const text = `
      SELECT user_id, context, created_at, updated_at
      FROM agent_user_context
      WHERE user_id = $1
    `;
    try {
      const result = await query(text, [userId]);
      return result.rows[0] ?? null;
    } catch (error) {
      logger.error({ error, userId }, 'Failed to find agent_user_context');
      throw error;
    }
  }

  static async upsert(
    userId: string,
    context: Record<string, AgentContextValue>
  ): Promise<AgentUserContextRow> {
    const text = `
      INSERT INTO agent_user_context (user_id, context, updated_at)
      VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET
        context = $2::jsonb,
        updated_at = CURRENT_TIMESTAMP
      RETURNING user_id, context, created_at, updated_at
    `;
    try {
      const result = await query(text, [userId, JSON.stringify(context)]);
      logger.info({ userId }, 'Agent user context upserted');
      return result.rows[0];
    } catch (error) {
      logger.error({ error, userId }, 'Failed to upsert agent_user_context');
      throw error;
    }
  }
}
