import { Inject, Injectable } from '@nestjs/common';

import { MAIL_TRANSPORT, type MailTransport } from './mail-transport';

/**
 * Application-facing mail API. Callers describe *what* to send (an OTP for a
 * given purpose); this service owns the copy/template and delegates the
 * actual delivery to the configured {@link MailTransport}.
 */
@Injectable()
export class MailerService {
  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport) {}

  async sendOtpEmail(to: string, code: string, ttlMinutes: number): Promise<void> {
    await this.transport.send({
      to,
      subject: 'Your ICH GCP Training verification code',
      text: [
        `Your verification code is: ${code}`,
        ``,
        `This code expires in ${ttlMinutes} minutes. If you did not request it, you can`,
        `safely ignore this email.`,
      ].join('\n'),
      html: `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in ${ttlMinutes} minutes. If you did not request it, you can safely ignore this email.</p>`,
    });
  }
}
