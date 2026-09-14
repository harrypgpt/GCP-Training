import { Injectable, Logger } from '@nestjs/common';

import { type MailMessage, type MailTransport } from './mail-transport';

/**
 * Safe local-development transport: logs the email instead of sending it.
 *
 * This is the ONLY place an OTP code is ever written anywhere the developer
 * can see it in plain text — it never appears in an API response. Selected
 * by default (`MAIL_TRANSPORT=console`); production must set
 * `MAIL_TRANSPORT=smtp` with real SMTP credentials — the architecture is the
 * same either way, only the transport implementation changes.
 */
@Injectable()
export class ConsoleMailTransport implements MailTransport {
  private readonly logger = new Logger('DevMail');

  async send(message: MailMessage): Promise<void> {
    this.logger.log(
      `\n──────── DEV EMAIL (not actually sent) ────────\n` +
        `To:      ${message.to}\n` +
        `Subject: ${message.subject}\n` +
        `${message.text}\n` +
        `────────────────────────────────────────────────`,
    );
    await Promise.resolve();
  }
}
