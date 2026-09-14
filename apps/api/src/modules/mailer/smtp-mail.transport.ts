import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { AppConfigService } from '../../config/app-config.service';
import { type MailMessage, type MailTransport } from './mail-transport';

/**
 * Production-shaped transport: sends real email over SMTP. Works against any
 * SMTP relay (SES, SendGrid, Postmark, a corporate relay) or a local test
 * catcher like Mailpit — only `SMTP_*` env vars change.
 */
@Injectable()
export class SmtpMailTransport implements MailTransport, OnModuleInit {
  private readonly logger = new Logger(SmtpMailTransport.name);
  private transporter: Transporter | undefined;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const { smtp } = this.config.mail;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user && smtp.password ? { user: smtp.user, pass: smtp.password } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      throw new Error('SmtpMailTransport used before initialisation');
    }
    await this.transporter.sendMail({
      from: this.config.mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    this.logger.log(`Sent email to ${message.to}`);
  }
}
