import { Module } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { ConsoleMailTransport } from './console-mail.transport';
import { MAIL_TRANSPORT } from './mail-transport';
import { MailerService } from './mailer.service';
import { SmtpMailTransport } from './smtp-mail.transport';

@Module({
  providers: [
    ConsoleMailTransport,
    SmtpMailTransport,
    {
      provide: MAIL_TRANSPORT,
      inject: [AppConfigService, ConsoleMailTransport, SmtpMailTransport],
      useFactory: (
        config: AppConfigService,
        consoleTransport: ConsoleMailTransport,
        smtpTransport: SmtpMailTransport,
      ) => (config.mail.transport === 'smtp' ? smtpTransport : consoleTransport),
    },
    MailerService,
  ],
  exports: [MailerService],
})
export class MailerModule {}
