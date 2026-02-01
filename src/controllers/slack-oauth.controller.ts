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
 * GET /api/v1/integrations/slack/oauth/authorize
 * Generate Slack OAuth authorization URL
 */
export const initiateOAuth = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const clientId = process.env.SLACK_CLIENT_ID;
    const redirectUri = `${
      process.env.API_BASE_URL || "http://localhost:3000"
    }/api/v1/integrations/slack/oauth/callback`;

    if (!clientId) {
      throw new AppError(
        500,
        "Slack OAuth is not configured",
        "SLACK_OAUTH_NOT_CONFIGURED"
      );
    }

    // Required scopes for posting messages, listing channels, and joining channels
    const scopes = [
      "chat:write",
      "channels:read",
      "channels:join",
      "groups:read",
      "groups:write",
    ];

    // Generate state parameter for CSRF protection
    const state = Buffer.from(
      JSON.stringify({ userId, timestamp: Date.now() })
    ).toString("base64");

    const authUrl = new URL("https://slack.com/oauth/v2/authorize");
    authUrl.searchParams.append("client_id", clientId);
    authUrl.searchParams.append("scope", scopes.join(","));
    authUrl.searchParams.append("redirect_uri", redirectUri);
    authUrl.searchParams.append("state", state);

    logger.info({ userId }, "Generated Slack OAuth authorization URL");

    const response: ApiResponse = {
      success: true,
      data: {
        authUrl: authUrl.toString(),
        state,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error(
      { error, userId: req.userId },
      "Failed to initiate Slack OAuth"
    );
    throw error;
  }
};

/**
 * GET /api/v1/integrations/slack/oauth/callback
 * Handle Slack OAuth callback and exchange code for access token
 */
export const handleOAuthCallback = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { code, error: oauthError, state } = req.query;

    if (oauthError) {
      // Return error page
      res.status(400).send(`
        <html>
          <body>
            <h2>Slack OAuth Error</h2>
            <p>${oauthError}</p>
            <script>
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
      return;
    }

    if (!code || typeof code !== "string") {
      res.status(400).send(`
        <html>
          <body>
            <h2>Error</h2>
            <p>Authorization code is required</p>
            <script>
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
      return;
    }

    // Extract userId from state parameter
    let userId: string;
    try {
      if (!state || typeof state !== "string") {
        throw new Error("State parameter is missing");
      }
      const stateData = JSON.parse(Buffer.from(state, "base64").toString());
      userId = stateData.userId;
      if (!userId) {
        throw new Error("User ID not found in state");
      }
    } catch (error) {
      res.status(400).send(`
        <html>
          <body>
            <h2>Error</h2>
            <p>Invalid state parameter</p>
            <script>
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
      return;
    }

    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    const redirectUri = `${
      process.env.API_BASE_URL || "http://localhost:3000"
    }/api/v1/integrations/slack/oauth/callback`;

    if (!clientId || !clientSecret) {
      res.status(500).send(`
        <html>
          <body>
            <h2>Configuration Error</h2>
            <p>Slack OAuth is not configured</p>
            <script>
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
      return;
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      res.status(502).send(`
        <html>
          <body>
            <h2>Error</h2>
            <p>Failed to exchange OAuth code for token</p>
            <script>
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
      return;
    }

    const tokenData = (await tokenResponse.json()) as any;

    if (!tokenData.ok) {
      res.status(400).send(`
        <html>
          <body>
            <h2>Slack OAuth Error</h2>
            <p>${tokenData.error || "Unknown error"}</p>
            <script>
              setTimeout(() => window.close(), 3000);
            </script>
          </body>
        </html>
      `);
      return;
    }

    // Store the OAuth connection
    const connection = await SlackConnectionModel.createOAuth({
      userId,
      accessToken: tokenData.access_token,
      teamId: tokenData.team.id,
      teamName: tokenData.team.name,
      // Default to first available channel (user can change later)
      channelId: tokenData.incoming_webhook?.channel_id || "",
      channelName: tokenData.incoming_webhook?.channel || "",
      scope: tokenData.scope,
      name: `${tokenData.team.name} OAuth`,
    });

    logger.info(
      { userId, connectionId: connection.id, teamId: tokenData.team.id },
      "Slack OAuth connection created successfully"
    );

    // Return success page that closes the popup
    res.status(200).send(`
      <html>
        <body>
          <h2>Success!</h2>
          <p>Slack workspace connected successfully. This window will close automatically.</p>
          <script>
            // Close the popup window
            setTimeout(() => window.close(), 1500);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error({ error }, "Failed to handle Slack OAuth callback");
    res.status(500).send(`
      <html>
        <body>
          <h2>Error</h2>
          <p>An unexpected error occurred</p>
          <script>
            setTimeout(() => window.close(), 3000);
          </script>
        </body>
      </html>
    `);
  }
};

/**
 * GET /api/v1/integrations/slack/connections/:connectionId/channels
 * List available channels for an OAuth connection
 */
export const listChannels = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const connectionId = paramString(req.params, "connectionId");

    // Verify connection belongs to user and is OAuth type
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

    if (connection.connection_type !== "oauth") {
      throw new AppError(
        400,
        "Channel listing is only available for OAuth connections",
        "INVALID_CONNECTION_TYPE"
      );
    }

    if (!connection.access_token) {
      throw new AppError(
        400,
        "OAuth access token not found",
        "MISSING_ACCESS_TOKEN"
      );
    }

    // Fetch public and private channels (user must be member)
    const channelsResponse = await fetch(
      "https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200&exclude_archived=true",
      {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
        },
      }
    );

    if (!channelsResponse.ok) {
      throw new AppError(
        502,
        "Failed to fetch channels from Slack",
        "SLACK_API_ERROR"
      );
    }

    const channelsData = (await channelsResponse.json()) as any;

    if (!channelsData.ok) {
      throw new AppError(
        400,
        `Slack API error: ${channelsData.error || "Unknown error"}`,
        "SLACK_API_ERROR"
      );
    }

    // Map all channels (both public and private) that the bot can access
    // The bot can access channels where:
    // 1. It's a public channel (can join with channels:join scope)
    // 2. It's a private channel where the bot is already a member
    // 3. It's a private channel where the user is a member (bot can be invited)
    const channels = channelsData.channels
      .filter((channel: any) => {
        // Exclude archived channels
        if (channel.is_archived) {
          return false;
        }
        // Include public channels
        if (!channel.is_private) {
          return true;
        }
        // For private channels, include if user is a member (bot can be invited)
        // or if bot is already a member
        return channel.is_member === true;
      })
      .map((channel: any) => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private || false,
        isMember: channel.is_member || false,
      }));

    logger.info(
      { userId, connectionId, channelCount: channels.length },
      "Successfully fetched Slack channels"
    );

    const response: ApiResponse = {
      success: true,
      data: {
        channels,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error(
      { error, userId: req.userId },
      "Failed to list Slack channels"
    );
    throw error;
  }
};

/**
 * PUT /api/v1/integrations/slack/connections/:connectionId/channel
 * Update the channel for an OAuth connection and join it if needed
 */
export const updateConnectionChannel = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const connectionId = paramString(req.params, "connectionId");
    const { channelId, channelName } = req.body;

    if (!channelId || !channelName) {
      throw new AppError(
        400,
        "Channel ID and channel name are required",
        "MISSING_CHANNEL_INFO"
      );
    }

    // Verify connection belongs to user and is OAuth type
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

    if (connection.connection_type !== "oauth") {
      throw new AppError(
        400,
        "Channel update is only available for OAuth connections",
        "INVALID_CONNECTION_TYPE"
      );
    }

    if (!connection.access_token) {
      throw new AppError(
        400,
        "OAuth access token not found",
        "MISSING_ACCESS_TOKEN"
      );
    }

    // Try to join the channel first (this will fail silently if already in channel or not needed)
    try {
      const joinResponse = await fetch(
        "https://slack.com/api/conversations.join",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${connection.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channelId,
          }),
        }
      );

      const joinData = (await joinResponse.json()) as any;

      // Log but don't fail if join fails - channel might be private or bot might already be in it
      if (!joinData.ok && joinData.error !== "already_in_channel") {
        logger.warn(
          { userId, connectionId, channelId, error: joinData.error },
          "Failed to join Slack channel, but continuing with channel update"
        );
      } else {
        logger.info(
          { userId, connectionId, channelId },
          "Successfully joined Slack channel"
        );
      }
    } catch (error) {
      // Don't fail the whole operation if join fails
      logger.warn(
        { error, userId, connectionId, channelId },
        "Error attempting to join Slack channel"
      );
    }

    // Update the connection with the new channel
    const updatedConnection = await SlackConnectionModel.update(
      connectionId,
      userId,
      {
        channelId,
        channelName,
      }
    );

    if (!updatedConnection) {
      throw new AppError(
        500,
        "Failed to update connection channel",
        "UPDATE_FAILED"
      );
    }

    logger.info(
      { userId, connectionId, channelId, channelName },
      "Successfully updated Slack connection channel"
    );

    const response: ApiResponse = {
      success: true,
      data: {
        connectionId: updatedConnection.id,
        channelId: updatedConnection.channel_id,
        channelName: updatedConnection.channel_name,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error(
      { error, userId: req.userId },
      "Failed to update Slack connection channel"
    );
    throw error;
  }
};

/**
 * POST /api/v1/integrations/slack/send
 * Send a message via Slack (supports both webhook and OAuth)
 * This function is exported to override the one in slack.controller.ts
 */
export const sendMessageOAuth = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const { connectionId, text, channelId } = req.body;

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

    let slackApiResponse: globalThis.Response;

    // Handle based on connection type
    if (connection.connection_type === "webhook") {
      // Original webhook logic
      if (!connection.webhook_url) {
        throw new AppError(
          400,
          "Webhook URL not found for this connection",
          "MISSING_WEBHOOK_URL"
        );
      }

      slackApiResponse = await fetch(connection.webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
    } else {
      // OAuth logic - post to chat.postMessage
      if (!connection.access_token) {
        throw new AppError(
          400,
          "OAuth access token not found",
          "MISSING_ACCESS_TOKEN"
        );
      }

      const targetChannelId = channelId || connection.channel_id;
      if (!targetChannelId) {
        throw new AppError(
          400,
          "Channel ID is required for OAuth connections",
          "MISSING_CHANNEL_ID"
        );
      }

      slackApiResponse = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: targetChannelId,
          text,
        }),
      });
    }

    if (!slackApiResponse.ok) {
      const errorText = await slackApiResponse.text();
      logger.error(
        {
          connectionId,
          userId,
          status: slackApiResponse.status,
          error: errorText,
        },
        "Slack API request failed"
      );

      // Handle specific Slack errors
      if (slackApiResponse.status === 429) {
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

      throw new AppError(
        502,
        "Failed to send message to Slack",
        "SLACK_API_ERROR"
      );
    }

    // For OAuth, check the response body as well
    if (connection.connection_type === "oauth") {
      const responseData = (await slackApiResponse.json()) as any;
      if (!responseData.ok) {
        // Provide user-friendly error messages for common errors
        let errorMessage = responseData.error || "Unknown error";
        if (responseData.error === "not_in_channel") {
          errorMessage =
            "Bot is not in the channel. Please select a channel and ensure the bot is added to it.";
        } else if (responseData.error === "channel_not_found") {
          errorMessage = "Channel not found. Please select a valid channel.";
        } else if (responseData.error === "is_archived") {
          errorMessage =
            "Cannot post to archived channel. Please select an active channel.";
        } else if (responseData.error === "missing_scope") {
          errorMessage =
            "Missing required permissions. Please reconnect your Slack workspace.";
        }

        throw new AppError(
          400,
          `Slack API error: ${errorMessage}`,
          "SLACK_API_ERROR",
          { slackError: responseData.error }
        );
      }
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
