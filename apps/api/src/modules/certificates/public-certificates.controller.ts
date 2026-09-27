import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../auth/jwt-auth.guard';
import { CERTIFICATE_VERIFY_THROTTLE } from './certificate.constants';
import { CertificatesService } from './certificates.service';

/**
 * No authentication required (`@Public()`). The verification code alone
 * identifies the record - no database id, no sequential/enumerable
 * identifier, no PII in the path. The response is deliberately minimal
 * (see `CertificatesService.verifyCertificate`): no email, phone, user id,
 * exam attempt id, or exam score. An invalid code returns the same generic
 * 404 a genuinely-never-issued code would, never revealing whether a
 * revoked/expired certificate once existed under that code.
 */
@Controller('public/certificates')
export class PublicCertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Public()
  @Throttle(CERTIFICATE_VERIFY_THROTTLE)
  @Get('verify/:verificationCode')
  verify(
    @Param('verificationCode') verificationCode: string,
  ): ReturnType<CertificatesService['verifyCertificate']> {
    return this.certificates.verifyCertificate(verificationCode);
  }
}
