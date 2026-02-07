import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requestLogger, errorHandler, notFoundHandler } from './middleware';
import routes from './routes';

export const createApp = (): Application => {
  const app = express();

  app.use(helmet());

  // CORS configuration
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    })
  );

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging middleware
  app.use(requestLogger);

  // API routes
  const apiVersion = process.env.API_VERSION || 'v1';
  app.use(`/api/${apiVersion}`, routes);

  // Root endpoint
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        message: 'Agentic Workflow Automation Backend',
        version: apiVersion,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
};
