import { EventEmitter } from 'events';
import { ExecutionStatus } from '../types';

/**
 * Execution Event Types
 */
export type ExecutionEventType =
    | 'execution:started'
    | 'execution:completed'
    | 'execution:failed'
    | 'node:started'
    | 'node:completed'
    | 'node:failed'
    | 'node:signature_required';

/**
 * Execution Event Data
 */
export interface ExecutionEvent {
    type: ExecutionEventType;
    executionId: string;
    workflowId?: string;
    nodeId?: string;
    nodeType?: string;
    status: ExecutionStatus;
    output?: any;
    error?: {
        message: string;
        code?: string;
    };
    // Transaction signing data (for signature_required events)
    safeTxHash?: string;
    safeTxData?: {
        to: string;
        value: string;
        data: string;
        operation: number;
    };
    timestamp: Date;
}

/**
 * Execution Event Emitter
 * 
 * Central event emitter for workflow execution events.
 * Used to broadcast real-time updates to connected clients via SSE/WebSocket.
 */
class ExecutionEventEmitterClass extends EventEmitter {
    constructor() {
        super();
        // Increase max listeners for high-concurrency scenarios
        this.setMaxListeners(2000);
    }

    /**
     * Emit an execution event
     * Events are broadcast to two channels:
     * 1. Execution-specific channel (`execution:{executionId}`)
     * 2. Global channel ('all') for monitoring dashboards
     */
    emitExecutionEvent(event: ExecutionEvent): void {
        // Emit to execution-specific listeners
        this.emit(`execution:${event.executionId}`, event);

        // Emit to global listeners (for monitoring/debugging)
        this.emit('all', event);
    }

    /**
     * Subscribe to events for a specific execution
     */
    subscribeToExecution(executionId: string, callback: (event: ExecutionEvent) => void): void {
        this.on(`execution:${executionId}`, callback);
    }

    /**
     * Unsubscribe from events for a specific execution
     */
    unsubscribeFromExecution(executionId: string, callback: (event: ExecutionEvent) => void): void {
        this.off(`execution:${executionId}`, callback);
    }

    /**
     * Subscribe to all execution events (for monitoring)
     */
    subscribeToAll(callback: (event: ExecutionEvent) => void): void {
        this.on('all', callback);
    }

    /**
     * Unsubscribe from all execution events
     */
    unsubscribeFromAll(callback: (event: ExecutionEvent) => void): void {
        this.off('all', callback);
    }
}

// Export singleton instance
export const executionEventEmitter = new ExecutionEventEmitterClass();
