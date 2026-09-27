import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AiErrorCode, AiOperation, AuditAction } from '@gcp/shared';
import {
  type AiRunStatus,
  type LearningObjectiveMatchType,
  Prisma,
  QuestionType,
} from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  GROUNDING_VERSION,
  GroundingService,
  type GroundingContext,
} from '../../ai/grounding/grounding.service';
import {
  AiProviderError,
  type AiProviderRequest,
  type AiProviderResponse,
} from '../../ai/interfaces/ai-types';
import { AiPolicyService } from '../../ai/policies/ai-policy.service';
import {
  buildCaseApplicationQuestionPrompt,
  buildDirectGcpQuestionPrompt,
  CASE_APPLICATION_QUESTION_GENERATION_PROMPT_VERSION,
  DIRECT_GCP_QUESTION_GENERATION_PROMPT_VERSION,
} from '../../ai/prompts/ich-e6r3-question-generation.prompt';
import { AiProviderFactory } from '../../ai/providers/provider.factory';
import {
  AI_OUTPUT_SCHEMA_VERSION,
  aiQuestionOutputSchema,
  type AiQuestionOutput,
} from '../../ai/validation/ai-output.schemas';
import {
  validateAiQuestionOutput,
  type AiQualityReport,
} from '../../ai/validation/ai-output.validator';
import {
  validateQuestionGovernance,
  type QuestionGovernanceInput,
  type QuestionGovernanceReport,
} from '../../ai/validation/question-governance-validator';
import { type GenerateCaseStudyQuestionDto } from './dto/generate-case-study-question.dto';
import { type GenerateDirectGcpQuestionDto } from './dto/generate-direct-gcp-question.dto';

export interface CaseStudyQuestionGenerationResult {
  runId: string;
  candidateId: string;
  candidateStatus: string;
}

/** Gate 18 §5: deterministically maps a real observation's OWN
 * classification onto the question's `scenarioSourceType` label - never an
 * independent AI decision, never a guess. */
function deriveScenarioSourceType(
  observationType: string,
  evidenceClass: string,
):
  | 'FDA_WARNING_LETTER'
  | 'FDA_483'
  | 'PRACTICAL_OBSERVATION'
  | 'EXPERT_OBSERVATION'
  | 'OTHER_APPROVED_CASE_EVIDENCE' {
  if (observationType === 'FDA_WARNING_LETTER_OBSERVATION') return 'FDA_WARNING_LETTER';
  if (observationType === 'FDA_483_OBSERVATION') return 'FDA_483';
  if (evidenceClass === 'PRACTICAL_EXPERIENCE') return 'PRACTICAL_OBSERVATION';
  if (observationType === 'PROPRIETARY_OBSERVATION') return 'EXPERT_OBSERVATION';
  return 'OTHER_APPROVED_CASE_EVIDENCE';
}

function combinedQualityReport(
  content: AiQualityReport,
  governance: QuestionGovernanceReport,
): Prisma.InputJsonValue {
  return {
    valid: content.valid && governance.valid,
    errors: [...content.errors, ...governance.errors],
    warnings: [...content.warnings, ...governance.warnings],
    checks: [...content.checks, ...governance.checks],
    governance,
  } as unknown as Prisma.InputJsonValue;
}

/**
 * Gate 17/18: generates a single-best-answer MCQ candidate. Two entry
 * points, matching Gate 18 §4's two non-mixable categories:
 *  - `generate()` - CASE_APPLICATION: grounded on a real, approved
 *    `CaseStudyVersion` (Gate 15/16 knowledge) for the SCENARIO, and one or
 *    more real, PUBLISHED ICH E6(R3) source sections for the NORMATIVE
 *    answer/rationale. Neither role may substitute for the other.
 *  - `generateDirectGcp()` - DIRECT_GCP: grounded SOLELY in ICH E6(R3); no
 *    observation/case-study evidence is accepted.
 *
 * Deliberately a SEPARATE service, not an addition to `AiGenerationService`
 * - the same precedent Gate 15's `CaseStudyGenerationService` set. Every
 * write still lands in the SAME `ai_generation_runs` /
 * `ai_question_candidates` tables, reuses the SAME
 * `AiProvider`/`AiPolicyService`/`AiProviderFactory` seam, the SAME
 * structured-output schema, and the SAME content validator - there is no
 * second question bank and no second AI run system. Gate 18 adds exactly
 * one more deterministic validation pass
 * (`validateQuestionGovernance`) that neither entry point can bypass.
 *
 * The AI is never the authority here: this service only ever produces a
 * GENERATED/VALIDATION_FAILED/READY_FOR_REVIEW `AiQuestionCandidate` row.
 * Human review (`AiCandidatesService.accept/reject`) and conversion into a
 * real, DRAFT `Question` (`AiCandidateConversionService.convert`) are both
 * fully reused, unmodified.
 */
@Injectable()
export class CaseStudyQuestionGenerationService {
  private readonly logger = new Logger(CaseStudyQuestionGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: AiPolicyService,
    private readonly providers: AiProviderFactory,
    private readonly grounding: GroundingService,
    private readonly config: AppConfigService,
  ) {}

  /** Gate 18 §4 TYPE 2 (CASE_APPLICATION). */
  async generate(
    caseStudyVersionId: string,
    dto: GenerateCaseStudyQuestionDto,
    actorId: string,
  ): Promise<CaseStudyQuestionGenerationResult> {
    this.policy.ensureEnabled();
    const provider = this.providers.getProvider();
    this.policy.ensureProviderAllowed(provider.name);
    const isExternalProvider = this.providers.isExternalProvider(provider.name);

    // Gate 17 §8/§10/§18 + Gate 18 §14/§18: ALL eligibility/approval/
    // external-AI/normative-grounding checks happen HERE, before any run
    // row exists and before the provider is ever invoked. Both calls fail
    // closed - nothing below this line executes if either throws.
    const [grounded, normative] = await Promise.all([
      this.grounding.buildQuestionContextFromCaseStudy(caseStudyVersionId, { isExternalProvider }),
      this.grounding.loadNormativeGcpSections(dto.normativeSourceSectionIds, {
        isExternalProvider,
      }),
    ]);

    const mergedContext: GroundingContext = {
      ...grounded.context,
      source: {
        id: normative.sourceVersionId,
        label: `ICH E6(R3) - Section ${normative.sections.map((s) => s.sectionIdentifier).join(', ')}`,
        citation: 'ICH E6(R3), Final Version, adopted 06 January 2025',
      },
    };

    const scenarioSourceType = deriveScenarioSourceType(
      grounded.observationType,
      grounded.evidenceClass,
    );
    const primarySectionId = normative.sections[0]?.id;
    if (!primarySectionId) {
      // Unreachable: loadNormativeGcpSections already requires >=1 section.
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AiErrorCode.NORMATIVE_GROUNDING_MISSING,
        'No normative section was resolved.',
      );
    }

    const run = await this.prisma.aiGenerationRun.create({
      data: {
        operation: AiOperation.QUESTION_GENERATION,
        provider: provider.name,
        model: this.config.ai.model,
        status: 'RUNNING',
        initiatedById: actorId,
        promptTemplateVersion: CASE_APPLICATION_QUESTION_GENERATION_PROMPT_VERSION,
        groundingVersion: GROUNDING_VERSION,
        outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
        observationId: grounded.observationId,
        groundingCaseStudyVersionId: grounded.caseStudyVersionId,
        ...(grounded.learningObjectiveId
          ? { learningObjectiveId: grounded.learningObjectiveId }
          : {}),
        ...(grounded.professionalRoleId ? { professionalRoleId: grounded.professionalRoleId } : {}),
        requestParams: {
          difficulty: dto.difficulty,
          ...(dto.optionCount !== undefined ? { optionCount: dto.optionCount } : {}),
          caseStudyVersionId: grounded.caseStudyVersionId,
          specificationId: grounded.specificationId,
          normativeSourceVersionId: normative.sourceVersionId,
          normativeSourceSectionIds: normative.sections.map((s) => s.id),
        } as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      action: AuditAction.AI_GENERATION_REQUESTED,
      entity: 'ai_generation_run',
      entityId: run.id,
      actorId,
      metadata: {
        operation: AiOperation.QUESTION_GENERATION,
        questionGenerationType: 'CASE_APPLICATION',
        provider: provider.name,
        caseStudyVersionId: grounded.caseStudyVersionId,
        normativeSourceVersionId: normative.sourceVersionId,
      },
    });

    try {
      const prompt = buildCaseApplicationQuestionPrompt(normative, mergedContext, {
        difficulty: dto.difficulty,
        ...(dto.optionCount !== undefined ? { optionCount: dto.optionCount } : {}),
      });

      const providerRequest: AiProviderRequest = {
        operation: AiOperation.QUESTION_GENERATION,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        context: {
          ...(dto.simulate ? { simulate: dto.simulate } : {}),
          // Always CASE_STUDY: this pathway exists specifically to ground
          // questions on an approved case-study version.
          questionType: 'CASE_STUDY',
          difficulty: dto.difficulty,
          source: mergedContext.source,
          caseStudy: mergedContext.caseStudy,
        },
        maxTokens: 2000,
        temperature: 0.2,
        timeoutMs: 30_000,
      };

      const response = await this.callWithRetry(provider, providerRequest);
      const output = this.parseAndValidateSchema(response.text);
      const contentQuality = validateAiQuestionOutput(output, mergedContext);

      const governanceInput: QuestionGovernanceInput = {
        questionGenerationType: 'CASE_APPLICATION',
        normativeSource: 'ICH_E6_R3',
        normativeSourceVersionId: normative.sourceVersionId,
        normativeSourceVersionStatus: normative.sourceVersionStatus,
        normativeSourceSectionId: primarySectionId,
        scenarioSourceType,
        caseStudyVersionId: grounded.caseStudyVersionId,
        // buildQuestionContextFromCaseStudy already REQUIRES APPROVED or
        // PUBLISHED before returning - recorded here for an honest,
        // self-contained governance report, not re-derived.
        caseStudyVersionStatus: 'APPROVED',
        trainingInterpretationApproved: grounded.trainingInterpretationId ? true : null,
        learningObjectiveId: grounded.learningObjectiveId,
        learningObjectiveMatchType: grounded.learningObjectiveId ? null : 'NO_MATCH',
      };
      const governance = validateQuestionGovernance(governanceInput);

      const candidateStatus =
        contentQuality.valid && governance.valid ? 'READY_FOR_REVIEW' : 'VALIDATION_FAILED';

      const candidate = await this.prisma.aiQuestionCandidate.create({
        data: {
          runId: run.id,
          status: candidateStatus,
          type: output.type as QuestionType,
          difficulty: dto.difficulty,
          stem: output.stem,
          ...(output.instructions ? { instructions: output.instructions } : {}),
          ...(output.explanation ? { explanation: output.explanation } : {}),
          ...(output.rationale ? { rationale: output.rationale } : {}),
          ...(grounded.domainId ? { domainId: grounded.domainId } : {}),
          ...(grounded.professionalRoleId
            ? { professionalRoleId: grounded.professionalRoleId }
            : {}),
          ...(grounded.learningObjectiveId
            ? { learningObjectiveId: grounded.learningObjectiveId }
            : {}),
          observationId: grounded.observationId,
          caseStudyVersionId: grounded.caseStudyVersionId,
          questionGenerationType: 'CASE_APPLICATION',
          normativeSource: 'ICH_E6_R3',
          normativeSourceVersionId: normative.sourceVersionId,
          normativeSourceSectionId: primarySectionId,
          scenarioSourceType,
          learningObjectiveMatchType:
            governanceInput.learningObjectiveMatchType as LearningObjectiveMatchType | null,
          qualityReport: combinedQualityReport(contentQuality, governance),
          qualitySignals: {
            evidenceCoverage: output.evidenceUsed.length > 0 ? 'present' : 'none',
            caseStudyGrounded: true,
            normativeGrounded: true,
            trainingInterpretationGrounded: grounded.trainingInterpretationId !== null,
            insufficientEvidenceFlagged: output.insufficientEvidence,
          } as unknown as Prisma.InputJsonValue,
          options: {
            create: output.options.map((option, index) => ({
              label: String.fromCharCode(65 + index),
              content: option.content,
              isCorrect: option.id === output.correctOptionId,
              ...(option.explanation ? { explanation: option.explanation } : {}),
              sortOrder: index,
            })),
          },
        },
      });

      await this.completeRun(run.id, 'SUCCEEDED', response.usage, response.latencyMs);
      await this.audit.record({
        action: AuditAction.AI_GENERATION_SUCCEEDED,
        entity: 'ai_generation_run',
        entityId: run.id,
        actorId,
        metadata: { candidateId: candidate.id, candidateStatus },
      });

      return { runId: run.id, candidateId: candidate.id, candidateStatus };
    } catch (error) {
      await this.handleGenerationFailure(run.id, actorId, error);
      throw error;
    }
  }

  /** Gate 18 §4 TYPE 1 (DIRECT_GCP): grounded solely in ICH E6(R3) - no
   * observation or case-study evidence is accepted or required. */
  async generateDirectGcp(
    dto: GenerateDirectGcpQuestionDto,
    actorId: string,
  ): Promise<CaseStudyQuestionGenerationResult> {
    this.policy.ensureEnabled();
    const provider = this.providers.getProvider();
    this.policy.ensureProviderAllowed(provider.name);
    const isExternalProvider = this.providers.isExternalProvider(provider.name);

    const normative = await this.grounding.loadNormativeGcpSections(dto.normativeSourceSectionIds, {
      isExternalProvider,
    });
    const primarySectionId = normative.sections[0]?.id;
    if (!primarySectionId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AiErrorCode.NORMATIVE_GROUNDING_MISSING,
        'No normative section was resolved.',
      );
    }

    const context: GroundingContext = {
      version: GROUNDING_VERSION,
      source: {
        id: normative.sourceVersionId,
        label: `ICH E6(R3) - Section ${normative.sections.map((s) => s.sectionIdentifier).join(', ')}`,
        citation: 'ICH E6(R3), Final Version, adopted 06 January 2025',
      },
      sourceSection: normative.sections.map((s) => s.sectionIdentifier).join(', '),
      caseStudy: null,
      observation: null,
      learningObjective: null,
      level: null,
      module: null,
      professionalRole: null,
      domain: null,
      knownIds: new Set([
        normative.sourceId,
        normative.sourceVersionId,
        ...normative.sections.map((s) => s.id),
      ]),
      groundingRules: [],
    };

    const run = await this.prisma.aiGenerationRun.create({
      data: {
        operation: AiOperation.QUESTION_GENERATION,
        provider: provider.name,
        model: this.config.ai.model,
        status: 'RUNNING',
        initiatedById: actorId,
        promptTemplateVersion: DIRECT_GCP_QUESTION_GENERATION_PROMPT_VERSION,
        groundingVersion: GROUNDING_VERSION,
        outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
        ...(dto.learningObjectiveId ? { learningObjectiveId: dto.learningObjectiveId } : {}),
        ...(dto.domainId ? { domainId: dto.domainId } : {}),
        requestParams: {
          difficulty: dto.difficulty,
          ...(dto.optionCount !== undefined ? { optionCount: dto.optionCount } : {}),
          normativeSourceVersionId: normative.sourceVersionId,
          normativeSourceSectionIds: normative.sections.map((s) => s.id),
        } as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      action: AuditAction.AI_GENERATION_REQUESTED,
      entity: 'ai_generation_run',
      entityId: run.id,
      actorId,
      metadata: {
        operation: AiOperation.QUESTION_GENERATION,
        questionGenerationType: 'DIRECT_GCP',
        provider: provider.name,
        normativeSourceVersionId: normative.sourceVersionId,
      },
    });

    try {
      const prompt = buildDirectGcpQuestionPrompt(normative, {
        difficulty: dto.difficulty,
        ...(dto.optionCount !== undefined ? { optionCount: dto.optionCount } : {}),
      });

      const providerRequest: AiProviderRequest = {
        operation: AiOperation.QUESTION_GENERATION,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        context: {
          ...(dto.simulate ? { simulate: dto.simulate } : {}),
          questionType: 'REGULATORY_INTERPRETATION',
          difficulty: dto.difficulty,
          source: context.source,
          caseStudy: null,
        },
        maxTokens: 2000,
        temperature: 0.2,
        timeoutMs: 30_000,
      };

      const response = await this.callWithRetry(provider, providerRequest);
      const output = this.parseAndValidateSchema(response.text);
      const contentQuality = validateAiQuestionOutput(output, context);

      const governanceInput: QuestionGovernanceInput = {
        questionGenerationType: 'DIRECT_GCP',
        normativeSource: 'ICH_E6_R3',
        normativeSourceVersionId: normative.sourceVersionId,
        normativeSourceVersionStatus: normative.sourceVersionStatus,
        normativeSourceSectionId: primarySectionId,
        scenarioSourceType: 'NONE',
        caseStudyVersionId: null,
        caseStudyVersionStatus: null,
        trainingInterpretationApproved: null,
        learningObjectiveId: dto.learningObjectiveId ?? null,
        learningObjectiveMatchType: dto.learningObjectiveId ? null : 'NO_MATCH',
      };
      const governance = validateQuestionGovernance(governanceInput);

      const candidateStatus =
        contentQuality.valid && governance.valid ? 'READY_FOR_REVIEW' : 'VALIDATION_FAILED';

      const candidate = await this.prisma.aiQuestionCandidate.create({
        data: {
          runId: run.id,
          status: candidateStatus,
          type: output.type as QuestionType,
          difficulty: dto.difficulty,
          stem: output.stem,
          ...(output.instructions ? { instructions: output.instructions } : {}),
          ...(output.explanation ? { explanation: output.explanation } : {}),
          ...(output.rationale ? { rationale: output.rationale } : {}),
          ...(dto.domainId ? { domainId: dto.domainId } : {}),
          ...(dto.learningObjectiveId ? { learningObjectiveId: dto.learningObjectiveId } : {}),
          questionGenerationType: 'DIRECT_GCP',
          normativeSource: 'ICH_E6_R3',
          normativeSourceVersionId: normative.sourceVersionId,
          normativeSourceSectionId: primarySectionId,
          scenarioSourceType: 'NONE',
          learningObjectiveMatchType:
            governanceInput.learningObjectiveMatchType as LearningObjectiveMatchType | null,
          qualityReport: combinedQualityReport(contentQuality, governance),
          qualitySignals: {
            evidenceCoverage: output.evidenceUsed.length > 0 ? 'present' : 'none',
            caseStudyGrounded: false,
            normativeGrounded: true,
            insufficientEvidenceFlagged: output.insufficientEvidence,
          } as unknown as Prisma.InputJsonValue,
          options: {
            create: output.options.map((option, index) => ({
              label: String.fromCharCode(65 + index),
              content: option.content,
              isCorrect: option.id === output.correctOptionId,
              ...(option.explanation ? { explanation: option.explanation } : {}),
              sortOrder: index,
            })),
          },
        },
      });

      await this.completeRun(run.id, 'SUCCEEDED', response.usage, response.latencyMs);
      await this.audit.record({
        action: AuditAction.AI_GENERATION_SUCCEEDED,
        entity: 'ai_generation_run',
        entityId: run.id,
        actorId,
        metadata: { candidateId: candidate.id, candidateStatus },
      });

      return { runId: run.id, candidateId: candidate.id, candidateStatus };
    } catch (error) {
      await this.handleGenerationFailure(run.id, actorId, error);
      throw error;
    }
  }

  private parseAndValidateSchema(text: string): AiQuestionOutput {
    const parsedJson = this.parseJson(text);
    return aiQuestionOutputSchema.parse(parsedJson);
  }

  private async completeRun(
    runId: string,
    status: AiRunStatus,
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined,
    latencyMs: number,
  ): Promise<void> {
    await this.prisma.aiGenerationRun.update({
      where: { id: runId },
      data: {
        status,
        completedAt: new Date(),
        latencyMs,
        ...(usage ? { tokenUsage: usage as Prisma.InputJsonValue } : {}),
      },
    });
  }

  private async handleGenerationFailure(
    runId: string,
    actorId: string,
    error: unknown,
  ): Promise<void> {
    const { status, errorCode, errorMessage } = this.classifyFailure(error);
    this.logger.warn(
      `Case-study-grounded question generation run ${runId} failed: ${errorMessage}`,
    );
    await this.prisma.aiGenerationRun.update({
      where: { id: runId },
      data: { status, completedAt: new Date(), errorCode, errorMessage },
    });
    await this.audit.record({
      action: AuditAction.AI_GENERATION_FAILED,
      entity: 'ai_generation_run',
      entityId: runId,
      actorId,
      metadata: { errorCode, errorMessage },
    });
  }

  private classifyFailure(error: unknown): {
    status: AiRunStatus;
    errorCode: string;
    errorMessage: string;
  } {
    if (error instanceof AiProviderError) {
      return {
        status: error.code === 'PROVIDER_TIMEOUT' ? 'TIMED_OUT' : 'FAILED',
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
    if (error instanceof AppException) {
      return {
        status: error.code === AiErrorCode.PROVIDER_TIMEOUT ? 'TIMED_OUT' : 'FAILED',
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
    return {
      status: 'FAILED',
      errorCode: AiErrorCode.MALFORMED_OUTPUT,
      errorMessage: error instanceof Error ? error.message : 'Unknown question generation failure',
    };
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new AppException(
        HttpStatus.BAD_GATEWAY,
        AiErrorCode.MALFORMED_OUTPUT,
        'The AI provider returned output that could not be parsed as JSON.',
      );
    }
  }

  private async callWithRetry(
    provider: { complete: (request: AiProviderRequest) => Promise<AiProviderResponse> },
    request: AiProviderRequest,
  ): Promise<AiProviderResponse> {
    const retries = this.config.ai.maxRetries;
    let attempt = 0;
    for (;;) {
      try {
        return await provider.complete(request);
      } catch (error) {
        const transient = error instanceof AiProviderError && error.transient;
        if (!transient || attempt >= retries) {
          if (error instanceof AiProviderError) {
            throw new AppException(
              error.code === 'PROVIDER_TIMEOUT'
                ? HttpStatus.GATEWAY_TIMEOUT
                : HttpStatus.BAD_GATEWAY,
              this.mapProviderErrorCode(error.code),
              error.message,
            );
          }
          throw error;
        }
        attempt += 1;
      }
    }
  }

  private mapProviderErrorCode(
    code: AiProviderError['code'],
  ): (typeof AiErrorCode)[keyof typeof AiErrorCode] {
    switch (code) {
      case 'PROVIDER_TIMEOUT':
        return AiErrorCode.PROVIDER_TIMEOUT;
      case 'PROVIDER_REFUSED':
        return AiErrorCode.PROVIDER_REFUSED;
      case 'PROVIDER_UNAVAILABLE':
      default:
        return AiErrorCode.PROVIDER_UNAVAILABLE;
    }
  }
}
