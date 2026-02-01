import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/privy-auth";
import { SlackConnectionModel } from "../models/slack";
import { ApiResponse } from "../types";
import { AppError } from "../middleware/error-handler";
import { logger } from "../utils/logger";

function paramString(
  params: Record<string, string | string[] | undefined>,
  key: string
): string {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  if (s == null || s === "")
    throw new AppError(400, `Missing or invalid parameter: ${key}`, "INVALID_PARAM");
  return s;
}

/**
 * POST /api/v1/integrations/slack/test
 * Test a webhook URL without saving (for verification before saving)
 */
export const testWebhook = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { webhookUrl, text } = req.body;

    // Send test message to Slack
    const slackResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!slackResponse.ok) {
      const errorText = await slackResponse.text();
      logger.error(
        { userId: req.userId, status: slackResponse.status, error: errorText },
        "Slack webhook test failed"
      );

      // Handle specific Slack errors
      if (slackResponse.status === 429) {
        let retryAfter = 1;
        try {
          const errorData = JSON.parse(errorText);
          retryAfter = errorData.retry_after || 1;
        } catch (e) {
          // ignore parse error
        }
        throw new AppError(
          429,
          `Slack rate limit exceeded. Please wait ${retryAfter} second(s) and try again.`,
          "SLACK_RATE_LIMITED",
          { retryAfter }
        );
      }

      if (slackResponse.status === 404) {
        throw new AppError(
          404,
          "Webhook URL not found. Please check your webhook URL.",
          "SLACK_WEBHOOK_NOT_FOUND"
        );
      }

      if (slackResponse.status === 410) {
        throw new AppError(
          410,
          "Slack webhook has been removed or expired. Please create a new webhook.",
          "SLACK_WEBHOOK_EXPIRED"
        );
      }

      // Generic error for other cases
      throw new AppError(
        502,
        "Failed to send test message. Please check your webhook URL.",
        "SLACK_WEBHOOK_ERROR"
      );
    }

    logger.info({ userId: req.userId }, "Slack webhook test successful");

    const response: ApiResponse = {
      success: true,
      data: {
        message: "Test message sent successfully",
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error({ error, userId: req.userId }, "Failed to test Slack webhook");
    throw error;
  }
};

/**
 * POST /api/v1/integrations/slack/webhooks
 * Create a new Slack webhook connection
 */
export const createWebhookConnection = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const { webhookUrl, name } = req.body;

    const connection = await SlackConnectionModel.create({
      userId,
      webhookUrl,
      name,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        connectionId: connection.id,
        name: connection.name,
        createdAt: connection.created_at,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error(
      { error, userId: req.userId },
      "Failed to create Slack webhook connection"
    );
    throw error;
  }
};

/**
 * POST /api/v1/integrations/slack/send
 * Send a message via Slack webhook
 */
export const sendMessage = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const { connectionId, text } = req.body;

    // Verify connection belongs to user
    const connection = await SlackConnectionModel.findByIdAndUser(
      connectionId,
      userId
    );

    if (!connection) {
      throw new AppError(
        404,
        "Slack connection not found",
        "CONNECTION_NOT_FOUND"
      );
    }

    // Ensure webhook URL exists for webhook connections
    if (!connection.webhook_url) {
      throw new AppError(
        400,
        "Webhook URL not found for this connection",
        "MISSING_WEBHOOK_URL"
      );
    }

    // Send message to Slack
    const slackResponse = await fetch(connection.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!slackResponse.ok) {
      const errorText = await slackResponse.text();
      logger.error(
        {
          connectionId,
          userId,
          status: slackResponse.status,
          error: errorText,
        },
        "Slack webhook request failed"
      );

      // Handle specific Slack errors
      if (slackResponse.status === 429) {
        let retryAfter = 1;
        try {
          const errorData = JSON.parse(errorText);
          retryAfter = errorData.retry_after || 1;
        } catch (e) {
          // ignore parse error
        }
        throw new AppError(
          429,
          `Slack rate limit exceeded. Please wait ${retryAfter} second(s) and try again.`,
          "SLACK_RATE_LIMITED",
          { retryAfter }
        );
      }

      if (slackResponse.status === 404) {
        throw new AppError(
          404,
          "Slack webhook URL not found. Please check your webhook configuration.",
          "SLACK_WEBHOOK_NOT_FOUND"
        );
      }

      if (slackResponse.status === 410) {
        throw new AppError(
          410,
          "Slack webhook has been removed or expired. Please create a new webhook.",
          "SLACK_WEBHOOK_EXPIRED"
        );
      }

      // Generic error for other cases
      throw new AppError(
        502,
        "Failed to send message to Slack. Please check your webhook URL.",
        "SLACK_WEBHOOK_ERROR"
      );
    }

    logger.info({ connectionId, userId }, "Message sent to Slack successfully");

    const response: ApiResponse = {
      success: true,
      data: {
        message: "Message sent successfully",
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error({ error, userId: req.userId }, "Failed to send Slack message");
    throw error;
  }
};

/**
 * GET /api/v1/integrations/slack/connections
 * Get all Slack connections for the authenticated user
 */
export const getConnections = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;

    const connections = await SlackConnectionModel.findByUserId(userId);

    // Map to safe format (exclude webhook URLs and access tokens from list response)
    const safeConnections = connections.map((conn) => ({
      id: conn.id,
      name: conn.name,
      connectionType: conn.connection_type,
      teamId: conn.team_id,
      teamName: conn.team_name,
      channelId: conn.channel_id,
      channelName: conn.channel_name,
      createdAt: conn.created_at,
    }));

    const response: ApiResponse = {
      success: true,
      data: {
        connections: safeConnections,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error(
      { error, userId: req.userId },
      "Failed to get Slack connections"
    );
    throw error;
  }
};

/**
 * PUT /api/v1/integrations/slack/connections/:connectionId
 * Update a Slack connection
 */
export const updateConnection = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const connectionId = paramString(req.params, "connectionId");
    const { webhookUrl, name } = req.body;

    const connection = await SlackConnectionModel.update(connectionId, userId, {
      webhookUrl,
      name,
    });

    if (!connection) {
      throw new AppError(
        404,
        "Slack connection not found",
        "CONNECTION_NOT_FOUND"
      );
    }

    const response: ApiResponse = {
      success: true,
      data: {
        connectionId: connection.id,
        name: connection.name,
        updatedAt: new Date().toISOString(),
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error(
      { error, userId: req.userId },
      "Failed to update Slack connection"
    );
    throw error;
  }
};

/**
 * DELETE /api/v1/integrations/slack/connections/:connectionId
 * Delete a Slack connection
 */
export const deleteConnection = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const connectionId = paramString(req.params, "connectionId");

    const deleted = await SlackConnectionModel.delete(connectionId, userId);

    if (!deleted) {
      throw new AppError(
        404,
        "Slack connection not found",
        "CONNECTION_NOT_FOUND"
      );
    }

    const response: ApiResponse = {
      success: true,
      data: {
        message: "Connection deleted successfully",
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error(
      { error, userId: req.userId },
      "Failed to delete Slack connection"
    );
    throw error;
  }
};
