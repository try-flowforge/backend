import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { emailService } from '../../email.service';
import { logger } from '../../../utils/logger';
import { templateString } from '../../../utils/template-engine';

/**
 * Email Node Configuration
 */
export interface EmailNodeConfig {
  to: string;
  subject: string;
  body: string;
}

/**
 * Email Node Processor
 * Handles execution of email nodes in workflows
 */
export class EmailNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.EMAIL;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, 'Executing email node');

    try {
      const config: EmailNodeConfig = input.nodeConfig;

      // Validate configuration
      const validation = await this.validate(config);
      if (!validation.valid) {
        throw new Error(`Invalid email configuration: ${validation.errors?.join(', ')}`);
      }

      // Check if email service is configured
      if (!emailService.isConfigured()) {
        throw new Error('Email service not configured. Check SMTP environment variables.');
      }

      // Template subject and body with input data from previous nodes
      const templatedSubject = templateString(config.subject, input.inputData);
      const templatedBody = templateString(config.body, input.inputData);

      // Send email
      logger.info(
        {
          nodeId: input.nodeId,
          to: config.to,
          subject: templatedSubject,
        },
        'Sending email from workflow'
      );

      const result = await emailService.sendEmail({
        to: config.to,
        subject: templatedSubject,
        body: templatedBody,
      });

      const endTime = new Date();

      if (!result.success) {
        return {
          nodeId: input.nodeId,
          success: false,
          output: {
            sent: false,
            error: result.error,
          },
          error: {
            message: result.error || 'Email sending failed',
            code: 'EMAIL_SEND_FAILED',
          },
          metadata: {
            startedAt: startTime,
            completedAt: endTime,
            duration: endTime.getTime() - startTime.getTime(),
          },
        };
      }

      // Email sent successfully
      logger.info(
        {
          nodeId: input.nodeId,
          messageId: result.messageId,
          to: config.to,
        },
        'Email sent successfully from workflow'
      );

      return {
        nodeId: input.nodeId,
        success: true,
        output: {
          sent: true,
          messageId: result.messageId,
          to: config.to,
          subject: templatedSubject,
          body: templatedBody,
          sentAt: new Date().toISOString(),
        },
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    } catch (error) {
      const endTime = new Date();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(
        {
          nodeId: input.nodeId,
          error: errorMessage,
        },
        'Email node execution failed'
      );

      return {
        nodeId: input.nodeId,
        success: false,
        output: {
          sent: false,
          error: errorMessage,
        },
        error: {
          message: errorMessage,
          code: 'EMAIL_NODE_EXECUTION_FAILED',
        },
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    }
  }

  async validate(config: any): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    // Validate recipient email
    if (!config.to || typeof config.to !== 'string') {
      errors.push('Recipient email (to) is required');
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(config.to)) {
        errors.push('Invalid recipient email address');
      }
    }

    // Validate subject
    if (!config.subject || typeof config.subject !== 'string') {
      errors.push('Subject is required');
    } else if (config.subject.length > 500) {
      errors.push('Subject must not exceed 500 characters');
    }

    // Validate body
    if (!config.body || typeof config.body !== 'string') {
      errors.push('Email body is required');
    } else if (config.body.length > 10000) {
      errors.push('Email body must not exceed 10000 characters');
    }

    if (errors.length > 0) {
      logger.warn(
        { errors, config },
        'Email node configuration validation failed'
      );
      return { valid: false, errors };
    }

    return { valid: true };
  }
}

