import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/privy-auth';
import { emailService } from '../services/email.service';
import { ApiResponse } from '../types';
import { AppError } from '../middleware/error-handler';
import { logger } from '../utils/logger';

/**
 * POST /api/v1/integrations/email/test
 * Test email sending without saving (for verification before workflow execution)
 */
export const testEmail = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { to, subject, body } = req.body;
    const userId = req.userId;

    // Check if email service is configured
    if (!emailService.isConfigured()) {
      logger.error(
        { userId },
        'Email service not configured - missing SMTP environment variables'
      );
      throw new AppError(
        503,
        'Email service is not configured. Please contact administrator.',
        'EMAIL_SERVICE_NOT_CONFIGURED'
      );
    }

    logger.info(
      { userId, to, subject },
      'Testing email send'
    );

    // Send test email
    const result = await emailService.sendEmail({
      to,
      subject,
      body,
    });

    if (!result.success) {
      logger.error(
        { userId, to, error: result.error },
        'Email test failed'
      );
      throw new AppError(
        502,
        result.error || 'Failed to send test email',
        'EMAIL_SEND_FAILED'
      );
    }

    logger.info(
      { userId, to, messageId: result.messageId },
      'Test email sent successfully'
    );

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Test email sent successfully',
        messageId: result.messageId,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error(
      { error, userId: req.userId },
      'Failed to send test email'
    );
    throw error;
  }
};

/**
 * POST /api/v1/integrations/email/send
 * Send an email (used in workflow execution or manual sending)
 */
export const sendEmail = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { to, subject, body } = req.body;
    const userId = req.userId;

    // Check if email service is configured
    if (!emailService.isConfigured()) {
      logger.error(
        { userId },
        'Email service not configured - missing SMTP environment variables'
      );
      throw new AppError(
        503,
        'Email service is not configured. Please contact administrator.',
        'EMAIL_SERVICE_NOT_CONFIGURED'
      );
    }

    logger.info(
      { userId, to, subject },
      'Sending email'
    );

    // Send email
    const result = await emailService.sendEmail({
      to,
      subject,
      body,
    });

    if (!result.success) {
      logger.error(
        { userId, to, error: result.error },
        'Email send failed'
      );
      throw new AppError(
        502,
        result.error || 'Failed to send email',
        'EMAIL_SEND_FAILED'
      );
    }

    logger.info(
      { userId, to, messageId: result.messageId },
      'Email sent successfully'
    );

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Email sent successfully',
        messageId: result.messageId,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error(
      { error, userId: req.userId },
      'Failed to send email'
    );
    throw error;
  }
};

