import { Request, Response, NextFunction } from 'express';
import { agentServiceConfig } from '../config/config';
import { AuthenticatedRequest } from './privy-auth';

/**
 * Middleware for agent routes. Requires X-Service-Key and X-On-Behalf-Of.
 * If valid, sets req.userId from X-On-Behalf-Of and continues; otherwise 401.
 */
export const requireAgentServiceAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const key = req.headers['x-service-key'];
  const onBehalfOf = req.headers['x-on-behalf-of'];

  if (
    typeof key === 'string' &&
    key.length > 0 &&
    typeof onBehalfOf === 'string' &&
    onBehalfOf.length > 0 &&
    agentServiceConfig.serviceKey &&
    key === agentServiceConfig.serviceKey
  ) {
    (req as AuthenticatedRequest).userId = onBehalfOf;
    (req as AuthenticatedRequest).userWalletAddress = '';
    next();
    return;
  }

  res.status(401).json({
    success: false,
    error: 'Missing or invalid agent service auth (X-Service-Key, X-On-Behalf-Of)',
  });
};
