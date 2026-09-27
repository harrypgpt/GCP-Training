import { HttpStatus, Injectable } from '@nestjs/common';

import { AiErrorCode, AuditAction } from '@gcp/shared';

import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import {
  evaluateMandatoryQualityGate,
  findCandidateDuplicates,
} from './candidate-duplicate-check.util';
import { AiCandidatesService, type CandidateWithRelations } from './ai-candidates.service';
import { type SubmitQualityReviewDto } from './dto/submit-quality-review.dto';

export interface QualityReviewResult {
  candidate: CandidateWithRelations;
  duplicateOf: string[];
  gateFailures: string[];
}

/**
 * Gate 21 §8/§12/§13/§53/§54: the structured, human quality-review layer
 * sitting IN FRONT OF the existing, completely unmodified
 * `AiCandidatesService.accept()`/`.reject()` - it never replaces that state
 * machine, it only gates entry into `accept()` behind a mandatory,
 * dimension-by-dimension human judgment plus a server-computed duplicate
 * check, and permanently records that judgment (`AiCandidateQualityReview`,
 * at most one per candidate, never updated).
 *
 * Fail-closed (§54): if any mandatory dimension is not PASS, or the
 * candidate is a duplicate of another non-discarded candidate/question, an
 * ACCEPT decision is refused (`QUALITY_REVIEW_GATE_FAILED`) - the review
 * record is still saved (proving the review occurred and correctly failed
 * closed), but the candidate's status is NOT changed to ACCEPTED.
 */
@Injectable()
export class AiCandidateQualityReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidates: AiCandidatesService,
    private readonly audit: AuditService,
  ) {}

  async submit(
    candidateId: string,
    dto: SubmitQualityReviewDto,
    actorId: string,
  ): Promise<QualityReviewResult> {
    const candidate = await this.candidates.get(candidateId);

    const existingReview = await this.prisma.aiCandidateQualityReview.findUnique({
      where: { candidateId },
    });
    if (existingReview) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.QUALITY_REVIEW_ALREADY_EXISTS,
        'This candidate already has a quality review record - reviews are immutable and cannot be resubmitted.',
      );
    }

    const duplicateOf = await findCandidateDuplicates(this.prisma, candidate);
    const gateFailures =
      dto.decision === 'ACCEPT'
        ? evaluateMandatoryQualityGate(
            candidate.questionGenerationType,
            dto.dimensions,
            duplicateOf,
          )
        : [];

    await this.prisma.aiCandidateQualityReview.create({
      data: {
        candidateId,
        reviewerId: actorId,
        decision: dto.decision,
        reviewComment: dto.reviewComment,
        qualityDimensions: dto.dimensions as unknown as object,
      },
    });
    await this.audit.record({
      action: AuditAction.AI_CANDIDATE_QUALITY_REVIEWED,
      entity: 'ai_question_candidate',
      entityId: candidateId,
      actorId,
      metadata: {
        decision: dto.decision,
        dimensions: dto.dimensions,
        duplicateOf,
        gateFailures,
      },
    });

    if (dto.decision === 'REJECT') {
      const rejected = await this.candidates.reject(candidateId, dto.reviewComment, actorId);
      return { candidate: rejected, duplicateOf, gateFailures };
    }

    if (gateFailures.length > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.QUALITY_REVIEW_GATE_FAILED,
        `This candidate cannot be accepted: ${gateFailures.join('; ')}`,
      );
    }

    const accepted = await this.candidates.accept(candidateId, actorId);
    return { candidate: accepted, duplicateOf, gateFailures: [] };
  }
}
