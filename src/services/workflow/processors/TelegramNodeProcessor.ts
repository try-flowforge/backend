import {
    NodeType,
    NodeExecutionInput,
    NodeExecutionOutput,
    TelegramNodeConfig,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { TelegramConnectionModel } from '../../../models/telegram';
import { logger } from '../../../utils/logger';
import { templateString } from '../../../utils/template-engine';

// Telegram API configuration (using centralized bot)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Telegram Node Processor
 * Handles execution of Telegram notification nodes in workflows
 */
export class TelegramNodeProcessor implements INodeProcessor {
    getNodeType(): NodeType {
        return NodeType.TELEGRAM;
    }

    async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
        const startTime = new Date();
        logger.info({ nodeId: input.nodeId }, 'Executing Telegram node');

        try {
            const config: TelegramNodeConfig = input.nodeConfig;
            const userId = input.executionContext.userId;

            // Validate configuration
            const validation = await this.validate(config);
            if (!validation.valid) {
                throw new Error(`Invalid Telegram configuration: ${validation.errors?.join(', ')}`);
            }

            // Check if Telegram bot is configured
            if (!TELEGRAM_BOT_TOKEN) {
                throw new Error('Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN environment variable.');
            }

            // Load connection from database
            const connection = await TelegramConnectionModel.findByIdAndUser(
                config.connectionId,
                userId
            );

            if (!connection) {
                throw new Error('Telegram connection not found or does not belong to user');
            }

            // Use chat ID from config or connection
            const chatId = config.chatId || connection.chat_id;
            if (!chatId) {
                throw new Error('Chat ID is required');
            }

            // Template the message with input data from previous nodes
            const message = templateString(config.message, input.inputData);

            // Send message via Telegram Bot API
            const sendResult = await this.sendMessage(chatId, message);

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
                        message: sendResult.error || 'Failed to send Telegram message',
                        code: 'TELEGRAM_SEND_FAILED',
                    },
                    metadata: {
                        startedAt: startTime,
                        completedAt: endTime,
                        duration: endTime.getTime() - startTime.getTime(),
                    },
                };
            }

            logger.info(
                { nodeId: input.nodeId, connectionId: config.connectionId, messageId: sendResult.messageId },
                'Telegram message sent successfully'
            );

            return {
                nodeId: input.nodeId,
                success: true,
                output: {
                    sent: true,
                    message,
                    chatId,
                    chatTitle: connection.chat_title,
                    messageId: sendResult.messageId,
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
                'Telegram node execution failed'
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
                    code: 'TELEGRAM_NODE_EXECUTION_FAILED',
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

        // Chat ID can be provided in config or will be loaded from connection
        // So we don't strictly require it here

        if (errors.length > 0) {
            logger.warn({ errors, config }, 'Telegram node configuration validation failed');
            return { valid: false, errors };
        }

        return { valid: true };
    }

    /**
     * Send message via Telegram Bot API
     */
    private async sendMessage(
        chatId: string,
        message: string
    ): Promise<{ success: boolean; messageId?: number; error?: string }> {
        try {
            const url = `${TELEGRAM_API_BASE}${TELEGRAM_BOT_TOKEN}/sendMessage`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'HTML', // Support basic HTML formatting
                }),
            });

            const result = await response.json() as { ok: boolean; result?: { message_id: number }; description?: string };

            if (!result.ok) {
                return {
                    success: false,
                    error: result.description || 'Telegram API request failed',
                };
            }

            return {
                success: true,
                messageId: result.result?.message_id,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Telegram API request failed',
            };
        }
    }
}
