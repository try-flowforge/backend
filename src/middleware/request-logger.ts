import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { randomUUID } from 'crypto';
import { SECURITY_CONSTANTS } from '../config/constants';

// Extend Express Request type to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Middleware to log incoming requests and attach request IDs
 * Request IDs can be passed via X-Request-ID header or will be auto-generated
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  // Use existing request ID from header or generate new one
  const requestId = req.get(SECURITY_CONSTANTS.REQUEST_ID_HEADER) || randomUUID();
  const startTime = Date.now();

  // Attach request ID to request object for use in other middleware
  req.requestId = requestId;

  // Set request ID on response header for client tracking
  res.setHeader(SECURITY_CONSTANTS.REQUEST_ID_HEADER, requestId);

  // Log incoming request
  logger.info(
    {
      requestId,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    },
    'Incoming request'
  );

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';

    logger[logLevel](
      {
        requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
      },
      'Request completed'
    );
  });

  next();
};
