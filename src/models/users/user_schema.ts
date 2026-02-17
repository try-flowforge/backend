import Joi from 'joi';

// Validation schema for creating a user
export const createUserSchema = Joi.object({
  id: Joi.string().required().min(1).max(255).messages({
    'string.empty': 'User ID is required',
    'any.required': 'User ID is required',
  }),
  address: Joi.string().required().min(1).max(255).messages({
    'string.empty': 'Address is required',
    'any.required': 'Address is required',
  }),
  email: Joi.string().email().required().messages({
    'string.email': 'Email must be a valid email address',
    'string.empty': 'Email is required',
    'any.required': 'Email is required',
  }),
  onboarded_at: Joi.date().iso().optional().default(() => new Date()),
});

// Validation schema for user ID parameter
export const userIdSchema = Joi.object({
  id: Joi.string().required().min(1).messages({
    'string.empty': 'User ID is required',
    'any.required': 'User ID is required',
  }),
});
// Validation schema for updating user chains
export const updateUserChainsSchema = Joi.object({
  chains: Joi.array().items(Joi.string()).required().messages({
    'array.base': 'Chains must be an array of strings',
    'any.required': 'Chains array is required',
  }),
});
