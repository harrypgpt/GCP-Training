import { IsUUID } from 'class-validator';

/**
 * The learner supplies only the attempt identifier. Every other fact the
 * certificate needs (learner identity, score, program/level names,
 * issuedAt/expiresAt, certificate/verification codes, status) is derived
 * server-side inside `CertificatesService` - there is no field here for a
 * client to submit any of them through, by construction.
 */
export class IssueCertificateDto {
  @IsUUID()
  attemptId!: string;
}
