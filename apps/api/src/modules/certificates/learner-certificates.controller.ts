import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { type RequestUser } from '../auth/jwt-auth.guard';
import { CertificatesService } from './certificates.service';
import { IssueCertificateDto } from './dto/issue-certificate.dto';

/**
 * Every route is authenticated (global JwtAuthGuard) and self-scoped via
 * `@CurrentUser()` - a learner can only ever issue or read their OWN
 * certificates, mirroring the exact ownership contract Gate 7B/7D/7E
 * established for exam attempts. The frontend may request issuance, but it
 * never decides eligibility - `CertificatesService` alone determines that.
 */
@Controller('learner/certificates')
export class LearnerCertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Post('issue')
  @HttpCode(HttpStatus.OK)
  issue(
    @Body() dto: IssueCertificateDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CertificatesService['issueCertificate']> {
    return this.certificates.issueCertificate(user.id, dto.attemptId);
  }

  @Get()
  list(@CurrentUser() user: RequestUser): ReturnType<CertificatesService['listCertificates']> {
    return this.certificates.listCertificates(user.id);
  }

  @Get(':certificateId')
  get(
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CertificatesService['getCertificate']> {
    return this.certificates.getCertificate(user.id, certificateId);
  }
}
