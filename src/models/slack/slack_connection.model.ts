import { query } from '../../config/database';
import { logger } from '../../utils/logger';
import { encrypt, decrypt } from '../../utils/encryption';

export type SlackConnectionType = 'webhook' | 'oauth';

export interface SlackConnection {
  id: string;
  user_id: string;
  name: string | null;
  connection_type: SlackConnectionType;
  // Webhook fields
  webhook_url?: string; // Decrypted URL (not the encrypted version from DB)
  // OAuth fields
  access_token?: string; // Decrypted token
  team_id?: string;
  team_name?: string;
  channel_id?: string;
  channel_name?: string;
  scope?: string;
  created_at: Date;
}

export interface CreateSlackConnectionInput {
  userId: string;
  webhookUrl: string;
  name?: string;
}

export interface CreateOAuthConnectionInput {
  userId: string;
  accessToken: string;
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  scope: string;
  name?: string;
}

export class SlackConnectionModel {
  /**
   * Create a new Slack webhook connection
   */
  static async create(input: CreateSlackConnectionInput): Promise<SlackConnection> {
    const { userId, webhookUrl, name } = input;

    // Encrypt webhook URL before storing
    const encryptedWebhookUrl = encrypt(webhookUrl);

    const text = `
      INSERT INTO slack_connections (user_id, webhook_url, name, connection_type)
      VALUES ($1, $2, $3, 'webhook')
      RETURNING id, user_id, name, webhook_url, connection_type, created_at
    `;
    const values = [userId, encryptedWebhookUrl, name || null];

    try {
      const result = await query(text, values);
      logger.info({ userId, connectionId: result.rows[0].id }, 'Slack webhook connection created');

      // Decrypt webhook URL before returning
      return {
        ...result.rows[0],
        webhook_url: decrypt(result.rows[0].webhook_url),
      };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to create Slack webhook connection');
      throw error;
    }
  }

  /**
   * Create a new Slack OAuth connection
   */
  static async createOAuth(input: CreateOAuthConnectionInput): Promise<SlackConnection> {
    const { userId, accessToken, teamId, teamName, channelId, channelName, scope, name } = input;

    // Encrypt access token before storing
    const encryptedAccessToken = encrypt(accessToken);

    const text = `
      INSERT INTO slack_connections (
        user_id, access_token, team_id, team_name, 
        channel_id, channel_name, scope, name, connection_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'oauth')
      RETURNING id, user_id, name, access_token, team_id, team_name, 
                channel_id, channel_name, scope, connection_type, created_at
    `;
    const values = [
      userId,
      encryptedAccessToken,
      teamId,
      teamName,
      channelId,
      channelName,
      scope,
      name || null
    ];

    try {
      const result = await query(text, values);
      logger.info(
        { userId, connectionId: result.rows[0].id, teamId, channelId },
        'Slack OAuth connection created'
      );

      // Decrypt access token before returning
      return {
        ...result.rows[0],
        access_token: decrypt(result.rows[0].access_token),
      };
    } catch (error) {
      logger.error({ error, userId, teamId }, 'Failed to create Slack OAuth connection');
      throw error;
    }
  }

  /**
   * Find a connection by ID and user ID (for security)
   */
  static async findByIdAndUser(connectionId: string, userId: string): Promise<SlackConnection | null> {
    const text = `
      SELECT id, user_id, name, connection_type, webhook_url, access_token,
             team_id, team_name, channel_id, channel_name, scope, created_at
      FROM slack_connections
      WHERE id = $1 AND user_id = $2
    `;
    const values = [connectionId, userId];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      // Decrypt sensitive fields based on connection type
      return {
        ...row,
        webhook_url: row.webhook_url ? decrypt(row.webhook_url) : undefined,
        access_token: row.access_token ? decrypt(row.access_token) : undefined,
      };
    } catch (error) {
      logger.error({ error, connectionId, userId }, 'Failed to find Slack connection');
      throw error;
    }
  }

  /**
   * Find all connections for a user
   * Note: This returns connections WITHOUT decrypted webhook URLs for list view
   * Use findByIdAndUser() to get the decrypted URL when needed
   */
  static async findByUserId(userId: string): Promise<Omit<SlackConnection, 'webhook_url' | 'access_token'>[]> {
    const text = `
      SELECT id, user_id, name, connection_type, team_id, team_name, 
             channel_id, channel_name, created_at
      FROM slack_connections
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const values = [userId];

    try {
      const result = await query(text, values);
      return result.rows;
    } catch (error) {
      logger.error({ error, userId }, 'Failed to find Slack connections for user');
      throw error;
    }
  }

  /**
   * Find OAuth connection by team ID and user ID
   */
  static async findByTeamAndUser(teamId: string, userId: string): Promise<SlackConnection | null> {
    const text = `
      SELECT id, user_id, name, connection_type, access_token,
             team_id, team_name, channel_id, channel_name, scope, created_at
      FROM slack_connections
      WHERE team_id = $1 AND user_id = $2 AND connection_type = 'oauth'
    `;
    const values = [teamId, userId];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        ...row,
        access_token: row.access_token ? decrypt(row.access_token) : undefined,
      };
    } catch (error) {
      logger.error({ error, teamId, userId }, 'Failed to find Slack OAuth connection by team');
      throw error;
    }
  }

  /**
   * Update a connection
   */
  static async update(
    connectionId: string,
    userId: string,
    updates: { name?: string; webhookUrl?: string; channelId?: string; channelName?: string }
  ): Promise<SlackConnection | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramCount}`);
      values.push(updates.name || null);
      paramCount++;
    }

    if (updates.webhookUrl !== undefined) {
      // Encrypt webhook URL before updating
      fields.push(`webhook_url = $${paramCount}`);
      values.push(encrypt(updates.webhookUrl));
      paramCount++;
    }

    if (updates.channelId !== undefined) {
      fields.push(`channel_id = $${paramCount}`);
      values.push(updates.channelId || null);
      paramCount++;
    }

    if (updates.channelName !== undefined) {
      fields.push(`channel_name = $${paramCount}`);
      values.push(updates.channelName || null);
      paramCount++;
    }

    if (fields.length === 0) {
      // No updates provided
      return await this.findByIdAndUser(connectionId, userId);
    }

    values.push(connectionId, userId);

    const text = `
      UPDATE slack_connections
      SET ${fields.join(', ')}
      WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
      RETURNING id, user_id, name, webhook_url, access_token, team_id, team_name, 
                channel_id, channel_name, scope, connection_type, created_at
    `;

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        return null;
      }
      logger.info({ connectionId, userId }, 'Slack connection updated');

      const row = result.rows[0];
      // Decrypt sensitive fields based on connection type
      return {
        ...row,
        webhook_url: row.webhook_url ? decrypt(row.webhook_url) : undefined,
        access_token: row.access_token ? decrypt(row.access_token) : undefined,
      };
    } catch (error) {
      logger.error({ error, connectionId, userId }, 'Failed to update Slack connection');
      throw error;
    }
  }

  /**
   * Delete a connection
   */
  static async delete(connectionId: string, userId: string): Promise<boolean> {
    const text = `
      DELETE FROM slack_connections
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `;
    const values = [connectionId, userId];

    try {
      const result = await query(text, values);
      if (result.rows.length === 0) {
        return false;
      }
      logger.info({ connectionId, userId }, 'Slack connection deleted');
      return true;
    } catch (error) {
      logger.error({ error, connectionId, userId }, 'Failed to delete Slack connection');
      throw error;
    }
  }
}
