import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '../utils/logger';

export interface EmailConfig {
  to: string;
  subject: string;
  body: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Email Service
 * Handles email sending via SMTP using credentials from environment variables
 */
export class EmailService {
  private transporter: Transporter | null = null;
  private readonly smtpHost: string;
  private readonly smtpPort: number;
  private readonly smtpSecure: boolean;
  private readonly smtpUser: string;
  private readonly smtpPass: string;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor() {
    // Load SMTP configuration from environment variables
    this.smtpHost = process.env.SMTP_HOST || '';
    this.smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    this.smtpSecure = process.env.SMTP_SECURE === 'true';
    this.smtpUser = process.env.SMTP_USER || '';
    this.smtpPass = process.env.SMTP_PASS || '';
    this.fromEmail = process.env.SMTP_FROM_EMAIL || '';
    this.fromName = process.env.SMTP_FROM_NAME || 'FlowForge';

    // Validate configuration
    if (!this.smtpHost || !this.smtpUser || !this.smtpPass || !this.fromEmail) {
      logger.warn(
        'Email service configuration incomplete. Check SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL environment variables.'
      );
    } else {
      this.initializeTransporter();
    }
  }

  /**
   * Initialize SMTP transporter
   */
  private initializeTransporter(): void {
    try {
      this.transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpSecure,
        auth: {
          user: this.smtpUser,
          pass: this.smtpPass,
        },
        pool: true, // Use connection pooling
        maxConnections: 5,
        maxMessages: 100,
      });

      logger.info(
        {
          host: this.smtpHost,
          port: this.smtpPort,
          secure: this.smtpSecure,
          from: this.fromEmail,
        },
        'Email service initialized'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to initialize email transporter');
      throw error;
    }
  }

  /**
   * Validate email address format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Check if email service is configured
   */
  isConfigured(): boolean {
    return this.transporter !== null;
  }

  /**
   * Send an email
   */
  async sendEmail(config: EmailConfig): Promise<EmailResult> {
    const { to, subject, body } = config;

    // Validate transporter
    if (!this.transporter) {
      logger.error('Email transporter not initialized. Check SMTP configuration.');
      return {
        success: false,
        error: 'Email service not configured. Please contact administrator.',
      };
    }

    // Validate recipient email
    if (!this.isValidEmail(to)) {
      logger.warn({ to }, 'Invalid recipient email address');
      return {
        success: false,
        error: `Invalid email address: ${to}`,
      };
    }

    // Validate required fields
    if (!subject || !body) {
      return {
        success: false,
        error: 'Subject and body are required',
      };
    }

    try {
      logger.info({ to, subject }, 'Sending email');

      const info = await this.transporter.sendMail({
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to,
        subject,
        text: body,
      });

      logger.info(
        {
          messageId: info.messageId,
          to,
          subject,
        },
        'Email sent successfully'
      );

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      logger.error(
        {
          error,
          to,
          subject,
        },
        'Failed to send email'
      );

      // Extract meaningful error message
      let errorMessage = 'Failed to send email';
      if (error instanceof Error) {
        // Handle common SMTP errors
        if (error.message.includes('Invalid login')) {
          errorMessage = 'SMTP authentication failed. Check email credentials.';
        } else if (error.message.includes('ECONNREFUSED')) {
          errorMessage = 'Could not connect to email server. Check SMTP host and port.';
        } else if (error.message.includes('ETIMEDOUT')) {
          errorMessage = 'Email server connection timeout. Please try again.';
        } else {
          errorMessage = error.message;
        }
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Verify SMTP connection
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) {
      logger.error('Email transporter not initialized');
      return false;
    }

    try {
      await this.transporter.verify();
      logger.info('SMTP connection verified successfully');
      return true;
    } catch (error) {
      logger.error({ error }, 'SMTP connection verification failed');
      return false;
    }
  }

  /**
   * Close transporter connections
   */
  async close(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
      logger.info('Email transporter closed');
    }
  }
}

// Export singleton instance
export const emailService = new EmailService();

