import { Response } from 'express';
import { executionEventEmitter, ExecutionEvent } from './ExecutionEventEmitter';
import { logger } from '../utils/logger';

/**
 * Execution SSE Service
 * 
 * Provides Server-Sent Events (SSE) endpoint for real-time execution status updates.
 * Clients can subscribe to execution updates and receive live progress.
 */

/**
 * Subscribe to execution updates via SSE
 * 
 * @param executionId - The execution ID to subscribe to
 * @param res - Express response object (will be kept open for SSE)
 */
export function subscribeToExecution(executionId: string, res: Response): void {
    logger.info({ executionId }, 'Client subscribing to execution updates');

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // For nginx proxy

    // Send initial connection confirmation
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ executionId, message: 'Connected to execution updates' })}\n\n`);

    // Create event listener
    const listener = (event: ExecutionEvent) => {
        try {
            // Send event to client
            res.write(`event: ${event.type}\n`);
            res.write(`data: ${JSON.stringify(event)}\n\n`);

            // If execution is complete or failed, close the connection after a short delay
            if (event.type === 'execution:completed' || event.type === 'execution:failed') {
                setTimeout(() => {
                    res.write(`event: close\n`);
                    res.write(`data: ${JSON.stringify({ reason: 'Execution finished' })}\n\n`);
                    res.end();
                }, 1000);
            }
        } catch (error) {
            logger.error({ error, executionId }, 'Error sending SSE event');
        }
    };

    // Subscribe to execution events
    executionEventEmitter.subscribeToExecution(executionId, listener);

    // Handle client disconnect
    res.on('close', () => {
        logger.info({ executionId }, 'Client disconnected from execution updates');
        executionEventEmitter.unsubscribeFromExecution(executionId, listener);
    });

    // Handle errors
    res.on('error', (error) => {
        logger.error({ error, executionId }, 'SSE connection error');
        executionEventEmitter.unsubscribeFromExecution(executionId, listener);
    });

    // Keep connection alive with heartbeat
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(`:heartbeat\n\n`);
        } catch {
            clearInterval(heartbeatInterval);
        }
    }, 30000);

    // Clear heartbeat on disconnect
    res.on('close', () => {
        clearInterval(heartbeatInterval);
    });
}

/**
 * Subscribe to all execution updates (for monitoring/admin dashboards)
 * 
 * @param res - Express response object
 */
export function subscribeToAllExecutions(res: Response): void {
    logger.info('Client subscribing to all execution updates');

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ message: 'Connected to all execution updates' })}\n\n`);

    const listener = (event: ExecutionEvent) => {
        try {
            res.write(`event: ${event.type}\n`);
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch (error) {
            logger.error({ error }, 'Error sending SSE event');
        }
    };

    executionEventEmitter.subscribeToAll(listener);

    res.on('close', () => {
        logger.info('Client disconnected from all execution updates');
        executionEventEmitter.unsubscribeFromAll(listener);
    });

    res.on('error', (error) => {
        logger.error({ error }, 'SSE connection error');
        executionEventEmitter.unsubscribeFromAll(listener);
    });

    // Heartbeat
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(`:heartbeat\n\n`);
        } catch {
            clearInterval(heartbeatInterval);
        }
    }, 30000);

    res.on('close', () => {
        clearInterval(heartbeatInterval);
    });
}
