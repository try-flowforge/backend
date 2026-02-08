import { Router } from 'express';
import userRoutes from './user.routes';
import relayRoutes from './relay.routes';
import slackRoutes from './integrations/slack.routes';
import telegramRoutes from './integrations/telegram.routes';
import emailRoutes from './integrations/email.routes';
import workflowRoutes from './workflow.routes';
import swapRoutes from './swap.routes';
import lendingRoutes from './lending.routes';
import metaRoutes from './meta.routes';
import oracleRoutes from './oracle.routes';
import ensRoutes from './ens.routes';

import { pool } from '../config/database';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';

const router = Router();

// Health check endpoint - comprehensive version
router.get('/health', async (_req, res) => {
  const startTime = Date.now();

  const checks: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    database: boolean;
    redis: boolean;
    timestamp: string;
    uptime: number;
    responseTime?: number;
    details?: Record<string, unknown>;
  } = {
    status: 'healthy',
    database: false,
    redis: false,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  // Check database connection
  try {
    await pool.query('SELECT 1');
    checks.database = true;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Health check: database connection failed'
    );
    checks.database = false;
  }

  // Check Redis connection
  try {
    await redisClient.ping();
    checks.redis = true;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Health check: Redis connection failed'
    );
    checks.redis = false;
  }

  // Determine overall health status
  const allHealthy = checks.database && checks.redis;
  const someHealthy = checks.database || checks.redis;

  if (allHealthy) {
    checks.status = 'healthy';
  } else if (someHealthy) {
    checks.status = 'degraded';
  } else {
    checks.status = 'unhealthy';
  }

  checks.responseTime = Date.now() - startTime;

  // Return appropriate status code
  const statusCode = allHealthy ? 200 : someHealthy ? 200 : 503;

  res.status(statusCode).json({
    success: allHealthy,
    data: checks,
  });
});

// Liveness probe - simple check that the server is running
router.get('/health/live', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'alive',
      timestamp: new Date().toISOString(),
    },
  });
});

// Readiness probe - checks if the server is ready to accept traffic
router.get('/health/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    await redisClient.ping();

    res.json({
      success: true,
      data: {
        status: 'ready',
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    res.status(503).json({
      success: false,
      data: {
        status: 'not ready',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// API routes
router.use('/users', userRoutes);
router.use('/relay', relayRoutes);
router.use('/integrations/slack', slackRoutes);
router.use('/integrations/telegram', telegramRoutes);
router.use('/integrations/email', emailRoutes);
router.use('/workflows', workflowRoutes);
router.use('/swaps', swapRoutes);
router.use('/lending', lendingRoutes);
router.use('/meta', metaRoutes);
router.use('/oracle', oracleRoutes);
router.use('/ens', ensRoutes);

export default router;
