import Joi from 'joi';

/**
 * Validation schema for creating a Slack webhook connection
 */
export const createSlackWebhookSchema = Joi.object({
  webhookUrl: Joi.string().uri().required().messages({
    'string.uri': 'Webhook URL must be a valid URL',
    'string.empty': 'Webhook URL is required',
    'any.required': 'Webhook URL is required',
  }),
  name: Joi.string().max(255).optional().messages({
    'string.max': 'Name must not exceed 255 characters',
  }),
});

/**
 * Validation schema for updating a Slack webhook connection
 */
export const updateSlackWebhookSchema = Joi.object({
  webhookUrl: Joi.string().uri().optional().messages({
    'string.uri': 'Webhook URL must be a valid URL',
  }),
  name: Joi.string().max(255).optional().allow(null, '').messages({
    'string.max': 'Name must not exceed 255 characters',
  }),
}).min(1);

/**
 * Validation schema for testing a webhook URL (without saving)
 */
export const testSlackWebhookSchema = Joi.object({
  webhookUrl: Joi.string().uri().required().messages({
    'string.uri': 'Webhook URL must be a valid URL',
    'string.empty': 'Webhook URL is required',
    'any.required': 'Webhook URL is required',
  }),
  text: Joi.string().required().max(4000).messages({
    'string.empty': 'Message text is required',
    'any.required': 'Message text is required',
    'string.max': 'Message text must not exceed 4000 characters',
  }),
});

/**
 * Validation schema for sending a Slack message
 */
export const sendSlackMessageSchema = Joi.object({
  connectionId: Joi.string().uuid().required().messages({
    'string.guid': 'Connection ID must be a valid UUID',
    'string.empty': 'Connection ID is required',
    'any.required': 'Connection ID is required',
  }),
  text: Joi.string().required().max(4000).messages({
    'string.empty': 'Message text is required',
    'any.required': 'Message text is required',
    'string.max': 'Message text must not exceed 4000 characters',
  }),
  channelId: Joi.string().optional().messages({
    'string.base': 'Channel ID must be a string',
  }),
});

/**
 * Validation schema for Slack OAuth callback
 */
export const slackOAuthCallbackSchema = Joi.object({
  code: Joi.string().required().messages({
    'string.empty': 'OAuth code is required',
    'any.required': 'OAuth code is required',
  }),
  state: Joi.string().optional(),
  error: Joi.string().optional(),
});

/**
 * Validation schema for updating OAuth connection channel
 */
export const updateSlackOAuthChannelSchema = Joi.object({
  channelId: Joi.string().required().messages({
    'string.empty': 'Channel ID is required',
    'any.required': 'Channel ID is required',
  }),
  channelName: Joi.string().required().messages({
    'string.empty': 'Channel name is required',
    'any.required': 'Channel name is required',
  }),
});
