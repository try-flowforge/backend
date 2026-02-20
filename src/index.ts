// Load config first (this loads dotenv and validates)
import './config/config';
import { createApp } from './app';
import { testConnection } from './config/database';
import { connectRedis } from './config/redis';
import { initializeQueues } from './config/queues';
import { initializeWorkers } from './services/workers';
import { logger } from './utils/logger';
import { config } from './config/config';

const startServer = async () => {
  try {
    // Test database connection
    logger.info('Testing database connection...');
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }

    // Connect to Redis
    logger.info('Connecting to Redis...');
    await connectRedis();

    // Initialize BullMQ queues
    logger.info('Initializing queues...');
    await initializeQueues();

    // Initialize workers
    logger.info('Initializing workers...');
    const workers = initializeWorkers();
    logger.info('Workers initialized successfully');

    // Create Express app
    const app = createApp();

    // Start server
    const server = app.listen(config.server.port, async () => {
      logger.info(
        {
          port: config.server.port,
          env: config.server.nodeEnv,
          apiVersion: config.server.apiVersion,
        },
        'Server started successfully'
      );

      // Register Telegram Webhook if configured
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const baseUrl = process.env.TELEGRAM_WEBHOOK_BASE_URL;
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

      if (botToken && baseUrl && secret) {
        try {
          const webhookUrl = `${baseUrl}/api/v1/integrations/telegram/webhook/${secret}`;
          logger.info({ webhookUrl }, 'Registering Telegram webhook...');

          const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: webhookUrl }),
          });

          const result = await response.json() as { ok: boolean; description?: string };
          if (result.ok) {
            logger.info('Telegram webhook registered successfully');
          } else {
            logger.error({ error: result.description }, 'Failed to register Telegram webhook');
          }
        } catch (err) {
          logger.error(
            {
              message: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            },
            'Error during Telegram webhook registration'
          );
        }
      } else {
        logger.warn('Telegram webhook skipped: Bot token, base URL, or secret not configured');
      }
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');

      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          // Close database connections
          const { pool } = await import('./config/database');
          await pool.end();
          logger.info('Database connections closed');

          // Close workers
          const { closeWorkers } = await import('./services/workers');
          await closeWorkers(workers);
          logger.info('Workers closed');

          // Close queues
          const { closeQueues } = await import('./config/queues');
          await closeQueues();
          logger.info('Queues closed');

          // Close Redis connection
          const { disconnectRedis } = await import('./config/redis');
          await disconnectRedis();

          logger.info('Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          logger.error({ error }, 'Error during graceful shutdown');
          process.exit(1);
        }
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error({ error }, 'Uncaught exception');
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error({ reason, promise }, 'Unhandled rejection');
      gracefulShutdown('unhandledRejection');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
};

startServer();
