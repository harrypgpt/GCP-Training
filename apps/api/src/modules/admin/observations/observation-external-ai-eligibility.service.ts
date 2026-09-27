import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import { DeIdentificationStatus, ExternalAiEligibility } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { type ExternalAiEligibilityDecisionDto } from './dto/external-ai-eligibility-decision.dto';

export interface ExternalAiEligibilityResult {
  observationVersionId: string;
  observationId: string;
  observationCode: string;
  externalAiEligibility: ExternalAiEligibility;
  deIdentificationStatus: DeIdentificationStatus;
}

function versionNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
    'Observation version not found.',
  );
}

/**
 * Gate 20 §8: the ONLY controlled mechanism by which an ObservationVersion
 * (and its parent Observation) may ever become eligible for an EXTERNAL AI
 * provider. This is a deliberate, small, dedicated service - never folded
 * into the generic `updateVersion()` path - because it is a distinct kind of
 * decision from ordinary content editing: it does not touch evidence,
 * classification, or curation content at all, only the external-AI
 * eligibility/de-identification labels, and it requires the version to have
 * ALREADY completed curation and have an ALREADY-APPROVED training
 * interpretation. No AI, script, or bulk/batch endpoint can invoke this -
 * there is no bulk variant, by design (Gate 20 §4/§8: "the approval must be
 * a human governance action", never regex/source-type/AI-recommendation
 * driven, never a mass update). Reuses the EXISTING audit framework
 * (`AuditService`/`AuditAction.OBSERVATION_AI_ELIGIBILITY_CHANGED`, defined
 * since an earlier gate but never wired up until now) rather than creating
 * a second one.
 */
@Injectable()
export class ObservationExternalAiEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async decide(
    versionId: string,
    dto: ExternalAiEligibilityDecisionDto,
    actorId: string,
  ): Promise<ExternalAiEligibilityResult> {
    const version = await this.prisma.observationVersion.findUnique({
      where: { id: versionId },
      include: {
        observation: { select: { id: true, observationCode: true, externalAiEligibility: true } },
        trainingInterpretations: { select: { reviewStatus: true } },
      },
    });
    if (!version) throw versionNotFound();

    if (dto.decision === 'APPROVE') {
      this.assertReadyForApproval(version);
    }

    const previousState = {
      versionExternalAiEligibility: version.externalAiEligibility,
      versionDeIdentificationStatus: version.deIdentificationStatus,
      observationExternalAiEligibility: version.observation.externalAiEligibility,
    };

    const newVersionEligibility =
      dto.decision === 'APPROVE'
        ? ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI
        : ExternalAiEligibility.INTERNAL_ONLY;
    const newDeIdentificationStatus =
      dto.decision === 'APPROVE'
        ? DeIdentificationStatus.APPROVED_FOR_EXTERNAL_AI
        : version.deIdentificationStatus === DeIdentificationStatus.APPROVED_FOR_EXTERNAL_AI
          ? DeIdentificationStatus.DE_IDENTIFIED
          : version.deIdentificationStatus;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedVersion = await tx.observationVersion.update({
        where: { id: versionId },
        data: {
          externalAiEligibility: newVersionEligibility,
          deIdentificationStatus: newDeIdentificationStatus,
        },
      });
      const updatedObservation = await tx.observation.update({
        where: { id: version.observationId },
        data: { externalAiEligibility: newVersionEligibility },
      });

      await this.audit.record(
        {
          action: AuditAction.OBSERVATION_AI_ELIGIBILITY_CHANGED,
          entity: 'observation_version',
          entityId: versionId,
          actorId,
          metadata: {
            observationVersionId: versionId,
            observationId: version.observationId,
            observationCode: version.observation.observationCode,
            reviewerId: actorId,
            decision: dto.decision,
            reason: dto.reason,
            previousState,
            newState: {
              versionExternalAiEligibility: newVersionEligibility,
              versionDeIdentificationStatus: newDeIdentificationStatus,
              observationExternalAiEligibility: newVersionEligibility,
            },
          },
        },
        tx,
      );

      return { updatedVersion, updatedObservation };
    });

    return {
      observationVersionId: versionId,
      observationId: version.observationId,
      observationCode: version.observation.observationCode,
      externalAiEligibility: updated.updatedVersion.externalAiEligibility,
      deIdentificationStatus: updated.updatedVersion.deIdentificationStatus,
    };
  }

  private assertReadyForApproval(version: {
    curationStatus: string;
    trainingInterpretations: { reviewStatus: string }[];
  }): void {
    const curated = version.curationStatus === 'CURATED' || version.curationStatus === 'APPROVED';
    const hasApprovedInterpretation = version.trainingInterpretations.some(
      (i) => i.reviewStatus === 'APPROVED',
    );
    if (!curated || !hasApprovedInterpretation) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ObservationErrorCode.NOT_READY_FOR_EXTERNAL_AI_ELIGIBILITY_DECISION,
        'External-AI eligibility can only be approved for an observation version that is already ' +
          'curated (CURATED/APPROVED) and has at least one APPROVED training interpretation.',
      );
    }
  }
}
