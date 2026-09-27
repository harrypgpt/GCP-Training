import { Module } from '@nestjs/common';

import { AdminCertificatesController } from './admin-certificates.controller';
import { CertificatesService } from './certificates.service';
import { LearnerCertificatesController } from './learner-certificates.controller';
import { PublicCertificatesController } from './public-certificates.controller';

/**
 * Gate 8: certificate engine. A single service backs three controllers
 * (learner, admin, public) since they all operate on the same `Certificate`
 * resource and the same eligibility/ownership rules - splitting the SERVICE
 * by audience would only duplicate that logic. `TrainingStateComputer` is
 * injected directly without an explicit import: it is provided by the
 * `@Global()` `ContentAccessModule` (see `LearnerContentModule`), already
 * loaded elsewhere in `AppModule`.
 */
@Module({
  controllers: [
    LearnerCertificatesController,
    AdminCertificatesController,
    PublicCertificatesController,
  ],
  providers: [CertificatesService],
})
export class CertificatesModule {}
