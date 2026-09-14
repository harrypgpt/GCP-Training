import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { MailerModule } from '../mailer/mailer.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  // Secrets are passed explicitly per sign/verify call (see TokenService), so
  // no default options are needed here.
  imports: [JwtModule.register({}), MailerModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, PasswordService, TokenService, JwtAuthGuard],
  // TokenService is consumed by the global JwtAuthGuard registered in AppModule.
  exports: [AuthService, TokenService],
})
export class AuthModule {}
