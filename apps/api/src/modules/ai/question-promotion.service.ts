import { HttpStatus, Injectable } from '@nestjs/common';

import { AiErrorCode, AuditAction } from '@gcp/shared';

import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { type QuestionDetail } from '../admin/questions/questions.service';
import { AiCandidateConversionService } from './ai-candidate-conversion.service';
import { AiCandidatesService, type CandidateWithRelations } from './ai-candidates.service';
import {
  evaluateMandatoryQualityGate,
  findCandidateDuplicates,
} from './candidate-duplicate-check.util';

/**
 * Gate 22 §6/§7/§8/§9: the controlled gate between an `ACCEPTED`
 * `AiQuestionCandidate` and the real question bank. This is deliberately
 * NOT a second conversion system - it is a thin, ADDITIONAL set of
 * re-checks sitting in front of the existing, unmodified
 * `AiCandidateConversionService.convert()`, which still performs the
 * actual `Question`/`QuestionVersion` write (always DRAFT, always via
 * `QuestionsService.create()`, exactly as a human author's request would).
 *
 * Promotion re-verifies, at the ACTUAL moment of promotion (never trusting
 * a stale check from review time, since time may have passed and new
 * candidates may have appeared since):
 *   1. the candidate is ACCEPTED,
 *   2. a human quality review exists at all (§7),
 *   3. every mandatory quality dimension is still PASS, using the EXACT
 *      same fail-closed gate Gate 21 uses at review time (shared, not
 *      duplicated logic - see `candidate-duplicate-check.util.ts`),
 *   4. the candidate is not a duplicate of some OTHER candidate/question
 *      that did not exist (or was not yet flagged) at review time,
 *   5. the candidate's own persisted deterministic validation/governance
 *      result (`qualityReport`, recorded once at generation time and never
 *      mutated) is actually valid,
 *   6. normative/scenario provenance is present and internally consistent
 *      for the candidate's `questionGenerationType`.
 *
 * Never auto-publishes - the created Question/QuestionVersion is always
 * DRAFT, exactly like the underlying conversion service already guarantees.
 */
@Injectable()
export class QuestionPromotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidates: AiCandidatesService,
    private readonly conversion: AiCandidateConversionService,
    private readonly audit: AuditService,
  ) {}

  async promote(candidateId: string, actorId: string): Promise<QuestionDetail> {
    const candidate = await this.candidates.get(candidateId);

    // §9: idempotency - a deterministic, already-existing error rather
    // than a second Question. Reuses the exact code the underlying
    // conversion service already throws for the same condition.
    if (candidate.convertedQuestionId) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.CANDIDATE_ALREADY_CONVERTED,
        'This candidate has already been converted into a question.',
      );
    }

    if (candidate.status !== 'ACCEPTED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.INVALID_CANDIDATE_TRANSITION,
        `Only an ACCEPTED candidate can be promoted into a question (current status: ${candidate.status}).`,
      );
    }

    const review = await this.prisma.aiCandidateQualityReview.findUnique({
      where: { candidateId },
    });
    if (!review || review.decision !== 'ACCEPT') {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.QUALITY_REVIEW_REQUIRED,
        'This candidate has no recorded ACCEPT quality review - promotion requires one to exist, not merely an ACCEPTED status.',
      );
    }

    const duplicateOf = await findCandidateDuplicates(this.prisma, candidate);
    const gateFailures = evaluateMandatoryQualityGate(
      candidate.questionGenerationType,
      review.qualityDimensions,
      duplicateOf,
    );
    if (gateFailures.length > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.QUALITY_REVIEW_GATE_FAILED,
        `This candidate cannot be promoted: ${gateFailures.join('; ')}`,
      );
    }

    this.assertDeterministicValidationPassed(candidate);
    this.assertGovernanceProvenanceIntact(candidate);

    // The existing, unmodified conversion path performs the actual write -
    // always a fresh DRAFT Question/QuestionVersion, never published.
    const question = await this.conversion.convert(candidateId, actorId);

    await this.audit.record({
      action: AuditAction.AI_CANDIDATE_PROMOTED_TO_QUESTION,
      entity: 'ai_question_candidate',
      entityId: candidateId,
      actorId,
      metadata: {
        questionId: question.id,
        questionVersionId: question.latestVersion.id,
        questionGenerationType: candidate.questionGenerationType,
        duplicateCheckPassed: duplicateOf.length === 0,
      },
    });

    return question;
  }

  /** Gate 22 §7: the candidate's own persisted deterministic
   * `validateAiQuestionOutput`/`validateQuestionGovernance` result
   * (recorded once at generation time, never mutated) must be valid.
   * Re-running those validators would require reconstructing a full
   * GroundingContext for no benefit - the immutable, already-persisted
   * result is exactly what they produced. */
  private assertDeterministicValidationPassed(candidate: CandidateWithRelations): void {
    const report = candidate.qualityReport as unknown as {
      valid?: boolean;
      governance?: { valid?: boolean };
    } | null;
    const contentValid = report?.valid === true;
    const governanceValid = report?.governance?.valid === true;
    if (!contentValid || !governanceValid) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.DETERMINISTIC_VALIDATION_NOT_PASSED,
        'This candidate does not have a persisted valid/valid deterministic validation and governance result.',
      );
    }
  }

  /** Gate 22 §7/§10: normative source is always mandatory; CASE_APPLICATION
   * additionally requires scenario/case-study provenance. Structurally,
   * an ACCEPTED, ICH-E6(R3)-lacking, or FDA-observation-as-normative
   * candidate should already be impossible (Gate 18's
   * `validateQuestionGovernance` blocks it before READY_FOR_REVIEW is ever
   * reached) - this is a defense-in-depth re-check, not the primary gate. */
  private assertGovernanceProvenanceIntact(candidate: CandidateWithRelations): void {
    if (candidate.normativeSource !== 'ICH_E6_R3' || !candidate.normativeSourceSection) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.NORMATIVE_GROUNDING_MISSING,
        'This candidate has no valid ICH E6(R3) normative source/section reference - it cannot be promoted.',
      );
    }
    if (candidate.questionGenerationType === 'CASE_APPLICATION') {
      const hasScenario =
        !!candidate.scenarioSourceType &&
        candidate.scenarioSourceType !== 'NONE' &&
        !!candidate.caseStudyVersion;
      if (!hasScenario) {
        throw new AppException(
          HttpStatus.CONFLICT,
          AiErrorCode.NORMATIVE_SOURCE_INVALID,
          'This CASE_APPLICATION candidate is missing its required scenario/case-study provenance.',
        );
      }
    }
  }
}
