import Joi from 'joi';

/**
 * Validation schema for saving a chat connection
 */
export const createTelegramConnectionSchema = Joi.object({
    chatId: Joi.string().required().messages({
        'string.empty': 'Chat ID is required',
        'any.required': 'Chat ID is required',
    }),
    chatTitle: Joi.string().required().messages({
        'string.empty': 'Chat title is required',
        'any.required': 'Chat title is required',
    }),
    chatType: Joi.string().valid('private', 'group', 'supergroup', 'channel').required().messages({
        'any.only': 'Chat type must be one of: private, group, supergroup, channel',
        'any.required': 'Chat type is required',
    }),
    name: Joi.string().max(255).optional().allow(null, '').messages({
        'string.max': 'Name must not exceed 255 characters',
    }),
});

/**
 * Validation schema for sending a Telegram message
 */
export const sendTelegramMessageSchema = Joi.object({
    connectionId: Joi.string().uuid().required().messages({
        'string.guid': 'Connection ID must be a valid UUID',
        'string.empty': 'Connection ID is required',
        'any.required': 'Connection ID is required',
    }),
    text: Joi.string().required().max(4096).messages({
        'string.empty': 'Message text is required',
        'any.required': 'Message text is required',
        'string.max': 'Message text must not exceed 4096 characters',
    }),
    parseMode: Joi.string().valid('Markdown', 'MarkdownV2', 'HTML').optional().messages({
        'any.only': 'Parse mode must be one of: Markdown, MarkdownV2, HTML',
    }),
});
