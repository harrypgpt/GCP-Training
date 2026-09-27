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

import { UserRole } from '@gcp/shared';

import { Roles } from '../../common/rbac/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { type RequestUser } from '../auth/jwt-auth.guard';
import { CertificatesService } from './certificates.service';
import { RevokeCertificateDto } from './dto/revoke-certificate.dto';

const ADMIN_ONLY = [UserRole.ADMIN];

/**
 * Minimal authorized certificate inspection and revocation - no analytics,
 * no bulk export, no mass revocation, per the Gate 8 spec's explicit scope
 * limit. Revocation is exclusively admin - there is no learner-facing path
 * that can ever set `status = REVOKED`.
 */
@Controller('admin/certificates')
@Roles(ADMIN_ONLY)
export class AdminCertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get(':certificateId')
  get(
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
  ): ReturnType<CertificatesService['getCertificateAdmin']> {
    return this.certificates.getCertificateAdmin(certificateId);
  }

  @Post(':certificateId/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
    @Body() dto: RevokeCertificateDto,
    @CurrentUser() admin: RequestUser,
  ): ReturnType<CertificatesService['revokeCertificate']> {
    return this.certificates.revokeCertificate(admin.id, certificateId, dto.reason);
  }
}
