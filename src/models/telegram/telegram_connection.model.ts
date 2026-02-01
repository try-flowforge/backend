import { query } from '../../config/database';
import { logger } from '../../utils/logger';

export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TelegramConnection {
    id: string;
    user_id: string;
    name: string | null;
    chat_id: string;
    chat_title: string;
    chat_type: TelegramChatType;
    created_at: Date;
    updated_at: Date;
}

export interface CreateTelegramConnectionInput {
    userId: string;
    chatId: string;
    chatTitle: string;
    chatType: TelegramChatType;
    name?: string;
}

export class TelegramConnectionModel {
    /**
     * Create or update a Telegram connection (upsert)
     */
    static async upsert(input: CreateTelegramConnectionInput): Promise<TelegramConnection> {
        const { userId, chatId, chatTitle, chatType, name } = input;

        const text = `
      INSERT INTO telegram_connections (user_id, chat_id, chat_title, chat_type, name)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, chat_id) 
      DO UPDATE SET 
        chat_title = EXCLUDED.chat_title,
        chat_type = EXCLUDED.chat_type,
        name = COALESCE(EXCLUDED.name, telegram_connections.name),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
        const values = [userId, chatId, chatTitle, chatType, name || null];

        try {
            const result = await query(text, values);
            logger.info({ userId, chatId }, 'Telegram connection upserted');
            return result.rows[0];
        } catch (error) {
            logger.error({ error, userId, chatId }, 'Failed to upsert Telegram connection');
            throw error;
        }
    }

    /**
     * Find a connection by ID and user ID
     */
    static async findByIdAndUser(connectionId: string, userId: string): Promise<TelegramConnection | null> {
        const text = `
      SELECT * FROM telegram_connections
      WHERE id = $1 AND user_id = $2
    `;
        const values = [connectionId, userId];

        try {
            const result = await query(text, values);
            return result.rows[0] || null;
        } catch (error) {
            logger.error({ error, connectionId, userId }, 'Failed to find Telegram connection');
            throw error;
        }
    }

    /**
     * Find all connections for a user
     */
    static async findByUserId(userId: string): Promise<TelegramConnection[]> {
        const text = `
      SELECT * FROM telegram_connections
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
        const values = [userId];

        try {
            const result = await query(text, values);
            return result.rows;
        } catch (error) {
            logger.error({ error, userId }, 'Failed to find Telegram connections for user');
            throw error;
        }
    }

    /**
     * Update connection name
     */
    static async updateName(
        connectionId: string,
        userId: string,
        name: string | null
    ): Promise<TelegramConnection | null> {
        const text = `
      UPDATE telegram_connections
      SET name = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `;
        const values = [name, connectionId, userId];

        try {
            const result = await query(text, values);
            if (result.rows.length === 0) return null;
            logger.info({ connectionId, userId }, 'Telegram connection name updated');
            return result.rows[0];
        } catch (error) {
            logger.error({ error, connectionId, userId }, 'Failed to update Telegram connection');
            throw error;
        }
    }

    /**
     * Delete a connection
     */
    static async delete(connectionId: string, userId: string): Promise<boolean> {
        const text = `
      DELETE FROM telegram_connections
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `;
        const values = [connectionId, userId];

        try {
            const result = await query(text, values);
            if (result.rows.length === 0) return false;
            logger.info({ connectionId, userId }, 'Telegram connection deleted');
            return true;
        } catch (error) {
            logger.error({ error, connectionId, userId }, 'Failed to delete Telegram connection');
            throw error;
        }
    }
}
