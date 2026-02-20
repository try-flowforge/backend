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
        const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/integrations/telegram/webhook/${secret}`;
        const isHttps = /^https:\/\//i.test(webhookUrl);

        if (!isHttps) {
          logger.warn(
            { webhookUrl },
            'Telegram webhook skipped: only HTTPS URLs are allowed by Telegram. Use a tunnel (e.g. ngrok) or leave TELEGRAM_WEBHOOK_BASE_URL unset for local dev.'
          );
        } else {
          const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;
          const maxAttempts = 3;

          const doRegister = async (): Promise<boolean> => {
            const response = await fetch(telegramApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: webhookUrl }),
              signal: AbortSignal.timeout(15_000),
            });
            const result = (await response.json()) as { ok?: boolean; description?: string };
            if (result.ok) {
              return true;
            }
            logger.warn({ status: response.status, error: result.description }, 'Telegram setWebhook returned not OK');
            return false;
          };

          try {
            logger.info({ webhookUrl }, 'Registering Telegram webhook...');

            let success = false;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                success = await doRegister();
                if (success) break;
                // Telegram returned ok: false (e.g. bad URL); don't retry
                break;
              } catch (err) {
                const cause = err instanceof Error && 'cause' in err ? (err as Error & { cause?: unknown }).cause : undefined;
                logger.warn(
                  { attempt, maxAttempts, error: err instanceof Error ? err.message : String(err), cause },
                  'Telegram webhook registration attempt failed (network error)'
                );
                if (attempt < maxAttempts) {
                  await new Promise((r) => setTimeout(r, 2000));
                } else {
                  throw err;
                }
              }
            }

            if (success) {
              logger.info('Telegram webhook registered successfully');
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const cause = error instanceof Error && 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined;
            logger.error(
              { error: message, cause },
              'Error during Telegram webhook registration (backend could not reach api.telegram.org; check network/DNS/firewall)'
            );
          }
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
