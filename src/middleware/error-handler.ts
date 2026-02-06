import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global error handler middleware
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log the error
  logger.error(
    {
      err,
      method: req.method,
      url: req.url,
      body: req.body,
      params: req.params,
      query: req.query,
    },
    'Error occurred'
  );

  // Default error response
  let statusCode = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL_ERROR';
  let details: any = undefined;

  // Handle known AppError
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code || 'APP_ERROR';
    details = err.details;
  }
  // Handle validation errors
  else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
    code = 'VALIDATION_ERROR';
  }
  // Handle database errors
  else if (err.message.includes('database') || err.message.includes('query')) {
    statusCode = 500;
    message = 'Database error occurred';
    code = 'DATABASE_ERROR';
  }

  const response: ApiResponse = {
    success: false,
    error: {
      message,
      code,
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: (req as any).requestId,
    },
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.error!.details = {
      ...details,
      stack: err.stack,
    };
  }

  res.status(statusCode).json(response);
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  logger.warn({ method: req.method, url: req.url, requestId: (req as any).requestId }, 'Route not found');

  const response: ApiResponse = {
    success: false,
    error: {
      message: `Route ${req.method} ${req.url} not found`,
      code: 'NOT_FOUND',
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: (req as any).requestId,
    },
  };

  res.status(404).json(response);
};

/**
 * Async handler wrapper to catch errors in async route handlers
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
