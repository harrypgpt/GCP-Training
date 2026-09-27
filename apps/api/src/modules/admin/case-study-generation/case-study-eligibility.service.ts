import { HttpStatus, Injectable } from '@nestjs/common';

import { CaseStudyEligibilityState, ObservationErrorCode } from '@gcp/shared';

import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';

export interface CaseStudyEligibilityResult {
  observationVersionId: string;
  state: CaseStudyEligibilityState;
  eligibleForSpecification: boolean;
  reasons: string[];
}

/**
 * Gate 15 §9: deterministic case-study eligibility for an ObservationVersion
 * - computed on read every time (mirrors Gate 13's `computeReadinessSummary`
 * pattern) rather than persisted as a second, competing readiness column
 * alongside the existing Gate 13 `caseStudyReadiness` field it is derived
 * from. No curated observation is ever automatically case-study-ready:
 * every rule below must pass before `eligibleForSpecification` is true.
 */
@Injectable()
export class CaseStudyEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async assess(observationVersionId: string): Promise<CaseStudyEligibilityResult> {
    const version = await this.prisma.observationVersion.findUnique({
      where: { id: observationVersionId },
      include: { professionalRoles: { select: { professionalRoleId: true } } },
    });
    if (!version) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
        'Observation version not found.',
      );
    }

    const reasons: string[] = [];

    // Rule 10: an ARCHIVED version is never usable as fresh case-study
    // grounding evidence again.
    if (version.reviewStatus === 'ARCHIVED') {
      reasons.push('The observation version is ARCHIVED.');
      return this.result(observationVersionId, 'NOT_READY', reasons);
    }

    // Rule 3: curation must have actually progressed past import.
    const curationSufficient =
      version.curationStatus === 'CURATED' || version.curationStatus === 'APPROVED';
    if (!curationSufficient) {
      reasons.push(`Curation is not yet complete (status: ${version.curationStatus}).`);
    }

    // Rule 4/5: domain + at least one role assigned.
    if (!version.domainId) reasons.push('No GCP domain has been curated for this observation.');
    if (version.professionalRoles.length === 0) {
      reasons.push('No professional role has been curated for this observation.');
    }

    // Rule 6: risk/severity/root-cause - at least one dimension curated so
    // the scenario has SOME categorized basis for its decision point.
    const hasRiskBasis =
      version.riskDimensions.length > 0 ||
      version.severity !== 'NOT_ASSESSED' ||
      version.rootCauseCategory !== null;
    if (!hasRiskBasis) {
      reasons.push('No risk dimension, severity, or root cause has been curated.');
    }

    // Rule 9: structurally invalid text can never ground a scenario.
    if (!version.originalText.trim()) {
      reasons.push('The observation has no evidence text.');
    }

    if (
      !curationSufficient ||
      !version.domainId ||
      version.professionalRoles.length === 0 ||
      !hasRiskBasis ||
      !version.originalText.trim()
    ) {
      return this.result(observationVersionId, 'NOT_READY', reasons);
    }

    // Rule 8: learning-objective linkage - missing is not a hard block, but
    // surfaces as HUMAN_REVIEW_REQUIRED rather than silently proceeding.
    if (!version.learningObjectiveId) {
      reasons.push(
        'No learning objective is linked - a human reviewer must confirm this observation is suitable without one.',
      );
      return this.result(observationVersionId, 'HUMAN_REVIEW_REQUIRED', reasons);
    }

    // Everything intrinsic to the observation itself checks out. Whether it
    // has already progressed further (a specification exists, or an
    // approved CaseStudyVersion already exists) is reported separately by
    // callers that already hold that context - this service only answers
    // "is this observation, on its own, fit to be specified".
    return this.result(observationVersionId, 'READY_FOR_SPECIFICATION', []);
  }

  private result(
    observationVersionId: string,
    state: CaseStudyEligibilityState,
    reasons: string[],
  ): CaseStudyEligibilityResult {
    return {
      observationVersionId,
      state,
      eligibleForSpecification: state === 'READY_FOR_SPECIFICATION',
      reasons,
    };
  }
}
