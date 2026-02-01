import Joi from 'joi';

/**
 * Validation schema for testing email (send test email)
 */
export const testEmailSchema = Joi.object({
  to: Joi.string().email().required().messages({
    'string.email': 'Recipient must be a valid email address',
    'string.empty': 'Recipient email is required',
    'any.required': 'Recipient email is required',
  }),
  subject: Joi.string().min(1).max(500).required().messages({
    'string.empty': 'Subject is required',
    'any.required': 'Subject is required',
    'string.max': 'Subject must not exceed 500 characters',
  }),
  body: Joi.string().min(1).max(10000).required().messages({
    'string.empty': 'Email body is required',
    'any.required': 'Email body is required',
    'string.max': 'Email body must not exceed 10000 characters',
  }),
});

/**
 * Validation schema for sending email (via workflow or manual)
 */
export const sendEmailSchema = Joi.object({
  to: Joi.string().email().required().messages({
    'string.email': 'Recipient must be a valid email address',
    'string.empty': 'Recipient email is required',
    'any.required': 'Recipient email is required',
  }),
  subject: Joi.string().min(1).max(500).required().messages({
    'string.empty': 'Subject is required',
    'any.required': 'Subject is required',
    'string.max': 'Subject must not exceed 500 characters',
  }),
  body: Joi.string().min(1).max(10000).required().messages({
    'string.empty': 'Email body is required',
    'any.required': 'Email body is required',
    'string.max': 'Email body must not exceed 10000 characters',
  }),
});

