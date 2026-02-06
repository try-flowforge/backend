import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { logger } from '../utils/logger';

/**
 * Middleware to validate request body against a Joi schema
 */
export const validateBody = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      logger.warn({ errors, body: req.body }, 'Validation error in request body');

      res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: errors,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: (req as any).requestId,
        },
      });
      return;
    }

    try {
      req.body = value;
    } catch (_e) {
      // Fallback for when req.body is read-only
      if (req.body && typeof req.body === 'object') {
        Object.keys(req.body).forEach(key => delete req.body[key]);
        Object.assign(req.body, value);
      }
    }
    next();
  };
};

/**
 * Middleware to validate request params against a Joi schema
 */
export const validateParams = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      logger.warn({ errors, params: req.params }, 'Validation error in request params');

      res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: errors,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: (req as any).requestId,
        },
      });
      return;
    }

    try {
      req.params = value;
    } catch (_e) {
      // Fallback for when req.params is read-only
      if (req.params && typeof req.params === 'object') {
        Object.keys(req.params).forEach(key => delete (req.params as any)[key]);
        Object.assign(req.params, value);
      }
    }
    next();
  };
};

/**
 * Middleware to validate request query against a Joi schema
 */
export const validateQuery = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      logger.warn({ errors, query: req.query }, 'Validation error in request query');

      res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: errors,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: (req as any).requestId,
        },
      });
      return;
    }

    try {
      req.query = value;
    } catch (_e) {
      // Fallback for when req.query is read-only
      if (req.query && typeof req.query === 'object') {
        Object.keys(req.query).forEach(key => delete (req.query as any)[key]);
        Object.assign(req.query, value);
      }
    }
    next();
  };
};
