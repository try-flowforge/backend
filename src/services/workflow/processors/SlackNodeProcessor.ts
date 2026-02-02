import {
    NodeType,
    NodeExecutionInput,
    NodeExecutionOutput,
    SlackNodeConfig,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { SlackConnectionModel } from '../../../models/slack';
import { logger } from '../../../utils/logger';

/**
 * Slack Node Processor
 * Handles execution of Slack notification nodes in workflows
 */
export class SlackNodeProcessor implements INodeProcessor {
    getNodeType(): NodeType {
        return NodeType.SLACK;
    }

    async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
        const startTime = new Date();
        logger.info({ nodeId: input.nodeId }, 'Executing Slack node');

        try {
            const config: SlackNodeConfig = input.nodeConfig;
            const userId = input.executionContext.userId;

            // Validate configuration
            const validation = await this.validate(config);
            if (!validation.valid) {
                throw new Error(`Invalid Slack configuration: ${validation.errors?.join(', ')}`);
            }

            // Load connection from database
            const connection = await SlackConnectionModel.findByIdAndUser(
                config.connectionId,
                userId
            );

            if (!connection) {
                throw new Error('Slack connection not found or does not belong to user');
            }

            // Template the message with input data from previous nodes
            const message = this.templateMessage(config.message, input.inputData);

            // Send message via webhook or OAuth
            let sendResult: { success: boolean; error?: string };

            if (connection.connection_type === 'webhook') {
                if (!connection.webhook_url) {
                    throw new Error('Webhook URL not found for this connection');
                }
                sendResult = await this.sendViaWebhook(connection.webhook_url, message);
            } else {
                // OAuth connection
                if (!connection.access_token) {
                    throw new Error('Access token not found for OAuth connection');
                }
                const channelId = config.channelId || connection.channel_id;
                if (!channelId) {
                    throw new Error('Channel ID is required for OAuth connections');
                }
                sendResult = await this.sendViaOAuth(connection.access_token, channelId, message);
            }

            const endTime = new Date();

            if (!sendResult.success) {
                return {
                    nodeId: input.nodeId,
                    success: false,
                    output: {
                        sent: false,
                        error: sendResult.error,
                    },
                    error: {
                        message: sendResult.error || 'Failed to send Slack message',
                        code: 'SLACK_SEND_FAILED',
                    },
                    metadata: {
                        startedAt: startTime,
                        completedAt: endTime,
                        duration: endTime.getTime() - startTime.getTime(),
                    },
                };
            }

            logger.info(
                { nodeId: input.nodeId, connectionId: config.connectionId },
                'Slack message sent successfully'
            );

            return {
                nodeId: input.nodeId,
                success: true,
                output: {
                    sent: true,
                    message,
                    connectionId: config.connectionId,
                    sentAt: new Date().toISOString(),
                },
                metadata: {
                    startedAt: startTime,
                    completedAt: endTime,
                    duration: endTime.getTime() - startTime.getTime(),
                },
            };
        } catch (error) {
            const endTime = new Date();
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            logger.error(
                { nodeId: input.nodeId, error: errorMessage },
                'Slack node execution failed'
            );

            return {
                nodeId: input.nodeId,
                success: false,
                output: {
                    sent: false,
                    error: errorMessage,
                },
                error: {
                    message: errorMessage,
                    code: 'SLACK_NODE_EXECUTION_FAILED',
                },
                metadata: {
                    startedAt: startTime,
                    completedAt: endTime,
                    duration: endTime.getTime() - startTime.getTime(),
                },
            };
        }
    }

    async validate(config: any): Promise<{ valid: boolean; errors?: string[] }> {
        const errors: string[] = [];

        if (!config) {
            errors.push('Config is required');
            return { valid: false, errors };
        }

        if (!config.connectionId) {
            errors.push('Connection ID is required');
        }

        if (!config.message || typeof config.message !== 'string') {
            errors.push('Message is required');
        }

        if (!config.connectionType || !['webhook', 'oauth'].includes(config.connectionType)) {
            errors.push('Connection type must be "webhook" or "oauth"');
        }

        if (errors.length > 0) {
            logger.warn({ errors, config }, 'Slack node configuration validation failed');
            return { valid: false, errors };
        }

        return { valid: true };
    }

    /**
     * Template message by replacing {{key}} placeholders with actual values
     */
    private templateMessage(template: string, data: Record<string, any>): string {
        if (!data || typeof data !== 'object') {
            return template;
        }

        return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
            const value = this.getValueByPath(data, path.trim());
            return value !== undefined ? String(value) : match;
        });
    }

    /**
     * Get nested value from object by path (e.g., "swap.txHash")
     */
    private getValueByPath(obj: any, path: string): any {
        return path.split('.').reduce((current, key) => current?.[key], obj);
    }

    /**
     * Send message via Slack webhook
     */
    private async sendViaWebhook(
        webhookUrl: string,
        message: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: message }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: `Webhook request failed: ${response.status} - ${errorText}`,
                };
            }

            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Webhook request failed',
            };
        }
    }

    /**
     * Send message via Slack OAuth API
     */
    private async sendViaOAuth(
        accessToken: string,
        channelId: string,
        message: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    channel: channelId,
                    text: message,
                }),
            });

            const result = await response.json() as { ok: boolean; error?: string };

            if (!result.ok) {
                return {
                    success: false,
                    error: result.error || 'Slack API request failed',
                };
            }

            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'OAuth API request failed',
            };
        }
    }
}
