import {
  LEARNER_CERTIFICATE_ROUTES,
  PUBLIC_CERTIFICATE_ROUTES,
  certificateDetailSchema,
  certificateSummarySchema,
  issueCertificateResponseSchema,
  publicCertificateVerificationSchema,
  type CertificateDetail,
  type CertificateSummary,
  type IssueCertificateResponse,
  type PublicCertificateVerification,
} from '@gcp/shared';
import { z } from 'zod';

import { apiGet } from './api';
import { authenticatedJson } from './auth/authenticated-fetch';

/**
 * Typed client for the Gate 8 certificate endpoints this UI uses. The
 * learner-facing methods reuse the existing authenticated fetch
 * infrastructure (`authenticatedJson`) - no new HTTP client. Public
 * verification reuses the existing unauthenticated `apiGet` helper (the
 * same one the health check uses), since it requires no auth token at all.
 */
export const certificateApi = {
  issue(attemptId: string): Promise<IssueCertificateResponse> {
    return authenticatedJson(LEARNER_CERTIFICATE_ROUTES.issue, issueCertificateResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ attemptId }),
    });
  },

  list(): Promise<CertificateSummary[]> {
    return authenticatedJson(LEARNER_CERTIFICATE_ROUTES.list, z.array(certificateSummarySchema));
  },

  get(certificateId: string): Promise<CertificateDetail> {
    return authenticatedJson(
      LEARNER_CERTIFICATE_ROUTES.get(certificateId),
      certificateDetailSchema,
    );
  },

  verify(verificationCode: string): Promise<PublicCertificateVerification> {
    return apiGet(
      PUBLIC_CERTIFICATE_ROUTES.verify(verificationCode),
      publicCertificateVerificationSchema,
    );
  },
};
