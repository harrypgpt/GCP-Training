import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AiErrorCode, AiOperation, AuditAction } from '@gcp/shared';
import { AiRunStatus, DifficultyLevel, Prisma, QuestionType } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app-exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildPaginatedResult,
  paginationSkipTake,
  type PaginatedResult,
} from '../admin/common/pagination';
import { type GenerateConceptsDto } from './dto/generate-concepts.dto';
import { type GenerateLearningObjectivesDto } from './dto/generate-learning-objectives.dto';
import { type GenerateQuestionsDto } from './dto/generate-questions.dto';
import { type ListRunsQueryDto } from './dto/list-runs.query.dto';
import {
  GROUNDING_VERSION,
  GroundingService,
  type GroundingContext,
} from './grounding/grounding.service';
import { AiProviderError, type AiProviderRequest } from './interfaces/ai-types';
import { AiPolicyService } from './policies/ai-policy.service';
import {
  buildConceptExtractionPrompt,
  CONCEPT_EXTRACTION_PROMPT_VERSION,
} from './prompts/concept-extraction.prompt';
import {
  buildLearningObjectivePrompt,
  LEARNING_OBJECTIVE_PROMPT_VERSION,
} from './prompts/learning-objective.prompt';
import {
  buildQuestionGenerationPrompt,
  QUESTION_GENERATION_PROMPT_VERSION,
} from './prompts/question-generation.prompt';
import { AiProviderFactory } from './providers/provider.factory';
import {
  AI_OUTPUT_SCHEMA_VERSION,
  aiQuestionOutputSchema,
  conceptExtractionOutputSchema,
  learningObjectiveOutputSchema,
} from './validation/ai-output.schemas';
import { validateAiQuestionOutput } from './validation/ai-output.validator';

export interface AiCandidateOptionInput {
  id: string;
  content: string;
  explanation?: string;
}

@Injectable()
export class AiGenerationService {
  private readonly logger = new Logger(AiGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: AiPolicyService,
    private readonly providers: AiProviderFactory,
    private readonly grounding: GroundingService,
    private readonly config: AppConfigService,
  ) {}

  async generateConcepts(
    dto: GenerateConceptsDto,
    actorId: string,
  ): Promise<{ runId: string; output: unknown }> {
    return this.runNonCandidateOperation(
      AiOperation.CONCEPT_EXTRACTION,
      dto,
      actorId,
      (context) => buildConceptExtractionPrompt(context),
      conceptExtractionOutputSchema,
    );
  }

  async generateLearningObjectives(
    dto: GenerateLearningObjectivesDto,
    actorId: string,
  ): Promise<{ runId: string; output: unknown }> {
    return this.runNonCandidateOperation(
      AiOperation.LEARNING_OBJECTIVE_GENERATION,
      dto,
      actorId,
      (context) => buildLearningObjectivePrompt(context),
      learningObjectiveOutputSchema,
    );
  }

  async generateQuestions(
    dto: GenerateQuestionsDto,
    actorId: string,
  ): Promise<{ runId: string; candidateId: string }> {
    this.policy.ensureEnabled();
    const provider = this.providers.getProvider();
    this.policy.ensureProviderAllowed(provider.name);
    const isExternalProvider = this.providers.isExternalProvider(provider.name);

    const context = await this.grounding.buildContext(dto, { isExternalProvider });

    const run = await this.createRun(AiOperation.QUESTION_GENERATION, provider.name, actorId, dto, {
      questionType: dto.questionType,
      difficulty: dto.difficulty,
      optionCount: dto.optionCount,
      variantLabel: dto.variantLabel,
    });

    await this.audit.record({
      action: AuditAction.AI_GENERATION_REQUESTED,
      entity: 'ai_generation_run',
      entityId: run.id,
      actorId,
      metadata: { operation: AiOperation.QUESTION_GENERATION, provider: provider.name },
    });

    try {
      const prompt = buildQuestionGenerationPrompt(context, {
        questionType: dto.questionType,
        difficulty: dto.difficulty,
        ...(dto.optionCount !== undefined ? { optionCount: dto.optionCount } : {}),
        ...(dto.variantLabel !== undefined ? { variantLabel: dto.variantLabel } : {}),
      });

      const providerRequest: AiProviderRequest = {
        operation: AiOperation.QUESTION_GENERATION,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        context: {
          ...(dto.simulate ? { simulate: dto.simulate } : {}),
          questionType: dto.questionType,
          difficulty: dto.difficulty,
          ...(dto.variantLabel ? { variantLabel: dto.variantLabel } : {}),
          source: context.source,
          caseStudy: context.caseStudy,
        },
        maxTokens: 2000,
        temperature: 0.2,
        timeoutMs: 30_000,
      };

      const response = await this.callWithRetry(provider, providerRequest);
      const parsedJson = this.parseJson(response.text);
      const output = aiQuestionOutputSchema.parse(parsedJson);
      const quality = validateAiQuestionOutput(output, context);

      const candidateStatus = quality.valid ? 'READY_FOR_REVIEW' : 'VALIDATION_FAILED';

      const candidate = await this.prisma.aiQuestionCandidate.create({
        data: {
          runId: run.id,
          status: candidateStatus,
          type: output.type as QuestionType,
          difficulty: output.difficulty as DifficultyLevel,
          stem: output.stem,
          ...(output.instructions ? { instructions: output.instructions } : {}),
          ...(output.explanation ? { explanation: output.explanation } : {}),
          ...(output.rationale ? { rationale: output.rationale } : {}),
          ...(dto.levelId ? { levelId: dto.levelId } : {}),
          ...(dto.domainId ? { domainId: dto.domainId } : {}),
          ...(dto.professionalRoleId ? { professionalRoleId: dto.professionalRoleId } : {}),
          ...(dto.learningObjectiveId ? { learningObjectiveId: dto.learningObjectiveId } : {}),
          ...(dto.sourceId ? { sourceId: dto.sourceId } : {}),
          ...(dto.sourceSection ? { sourceSection: dto.sourceSection } : {}),
          ...(dto.observationId ? { observationId: dto.observationId } : {}),
          qualityReport: quality as unknown as Prisma.InputJsonValue,
          qualitySignals: this.deriveQualitySignals(
            output,
            context,
          ) as unknown as Prisma.InputJsonValue,
          options: {
            create: output.options.map((option, index) => ({
              label: String.fromCharCode(65 + index),
              content: option.content,
              isCorrect: option.id === output.correctOptionId,
              ...(option.explanation ? { explanation: option.explanation } : {}),
              sortOrder: index,
            })),
          },
          ...(dto.caseStudyId
            ? { caseStudyLinks: { create: [{ caseStudyId: dto.caseStudyId }] } }
            : {}),
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

      return { runId: run.id, candidateId: candidate.id };
    } catch (error) {
      await this.handleGenerationFailure(run.id, actorId, error);
      throw error;
    }
  }

  async getRun(
    id: string,
  ): Promise<Prisma.AiGenerationRunGetPayload<{ include: typeof RUN_INCLUDE }>> {
    const run = await this.prisma.aiGenerationRun.findUnique({
      where: { id },
      include: RUN_INCLUDE,
    });
    if (!run) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AiErrorCode.PROVIDER_UNAVAILABLE,
        'AI generation run not found',
      );
    }
    return run;
  }

  async listRuns(
    query: ListRunsQueryDto,
  ): Promise<PaginatedResult<Prisma.AiGenerationRunGetPayload<{ include: typeof RUN_INCLUDE }>>> {
    const where: Prisma.AiGenerationRunWhereInput = {
      ...(query.operation ? { operation: query.operation } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.aiGenerationRun.findMany({
        where,
        include: RUN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.aiGenerationRun.count({ where }),
    ]);
    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  // ---------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------

  private async runNonCandidateOperation(
    operation:
      | typeof AiOperation.CONCEPT_EXTRACTION
      | typeof AiOperation.LEARNING_OBJECTIVE_GENERATION,
    dto: GenerateConceptsDto | GenerateLearningObjectivesDto,
    actorId: string,
    buildPrompt: (context: GroundingContext) => {
      version: string;
      systemPrompt: string;
      userPrompt: string;
    },
    schema: { parse: (value: unknown) => unknown },
  ): Promise<{ runId: string; output: unknown }> {
    this.policy.ensureEnabled();
    const provider = this.providers.getProvider();
    this.policy.ensureProviderAllowed(provider.name);
    const isExternalProvider = this.providers.isExternalProvider(provider.name);

    const context = await this.grounding.buildContext(dto, { isExternalProvider });
    const run = await this.createRun(operation, provider.name, actorId, dto, {});

    await this.audit.record({
      action: AuditAction.AI_GENERATION_REQUESTED,
      entity: 'ai_generation_run',
      entityId: run.id,
      actorId,
      metadata: { operation, provider: provider.name },
    });

    try {
      const prompt = buildPrompt(context);
      const providerRequest: AiProviderRequest = {
        operation,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        context: {
          ...(dto.simulate ? { simulate: dto.simulate } : {}),
          source: context.source,
          caseStudy: context.caseStudy,
        },
        maxTokens: 1200,
        temperature: 0.2,
        timeoutMs: 30_000,
      };

      const response = await this.callWithRetry(provider, providerRequest);
      const parsedJson = this.parseJson(response.text);
      const output = schema.parse(parsedJson);

      await this.prisma.aiGenerationRun.update({
        where: { id: run.id },
        data: { output: output as Prisma.InputJsonValue },
      });
      await this.completeRun(run.id, 'SUCCEEDED', response.usage, response.latencyMs);
      await this.audit.record({
        action: AuditAction.AI_GENERATION_SUCCEEDED,
        entity: 'ai_generation_run',
        entityId: run.id,
        actorId,
        metadata: { operation },
      });

      return { runId: run.id, output };
    } catch (error) {
      await this.handleGenerationFailure(run.id, actorId, error);
      throw error;
    }
  }

  private createRun(
    operation: AiOperation,
    provider: string,
    actorId: string,
    dto: {
      sourceId?: string;
      sourceSection?: string;
      caseStudyId?: string;
      observationId?: string;
      learningObjectiveId?: string;
      levelId?: string;
      moduleId?: string;
      professionalRoleId?: string;
      domainId?: string;
    },
    requestParams: Record<string, unknown>,
  ): ReturnType<PrismaService['aiGenerationRun']['create']> {
    return this.prisma.aiGenerationRun.create({
      data: {
        operation,
        provider,
        model: this.config.ai.model,
        status: 'RUNNING',
        initiatedById: actorId,
        promptTemplateVersion: this.promptVersionFor(operation),
        groundingVersion: GROUNDING_VERSION,
        outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
        ...(dto.sourceId ? { sourceId: dto.sourceId } : {}),
        ...(dto.sourceSection ? { sourceSection: dto.sourceSection } : {}),
        ...(dto.caseStudyId ? { caseStudyId: dto.caseStudyId } : {}),
        ...(dto.observationId ? { observationId: dto.observationId } : {}),
        ...(dto.learningObjectiveId ? { learningObjectiveId: dto.learningObjectiveId } : {}),
        ...(dto.levelId ? { levelId: dto.levelId } : {}),
        ...(dto.moduleId ? { moduleId: dto.moduleId } : {}),
        ...(dto.professionalRoleId ? { professionalRoleId: dto.professionalRoleId } : {}),
        ...(dto.domainId ? { domainId: dto.domainId } : {}),
        requestParams: requestParams as Prisma.InputJsonValue,
      },
    });
  }

  private promptVersionFor(operation: AiOperation): string {
    switch (operation) {
      case AiOperation.CONCEPT_EXTRACTION:
        return CONCEPT_EXTRACTION_PROMPT_VERSION;
      case AiOperation.LEARNING_OBJECTIVE_GENERATION:
        return LEARNING_OBJECTIVE_PROMPT_VERSION;
      case AiOperation.QUESTION_GENERATION:
      case AiOperation.QUESTION_VARIATION:
        return QUESTION_GENERATION_PROMPT_VERSION;
      default:
        return 'unversioned';
    }
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
    this.logger.warn(`AI generation run ${runId} failed: ${errorMessage}`);
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
      errorMessage: error instanceof Error ? error.message : 'Unknown AI generation failure',
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

  /** Only TRANSIENT provider failures are retried — invalid output and
   * business-validation failures never are (Stage 6B retry-policy
   * requirement). Bounded by AI_MAX_RETRIES; no infinite retries. */
  private async callWithRetry(
    provider: {
      complete: (request: AiProviderRequest) => Promise<{
        text: string;
        usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
        latencyMs: number;
        model: string;
      }>;
    },
    request: AiProviderRequest,
    maxRetries?: number,
  ): ReturnType<typeof provider.complete> {
    const retries = maxRetries ?? this.config.ai.maxRetries;
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

  private deriveQualitySignals(
    output: {
      evidenceUsed: string[];
      reasoningDimensions: string[];
      insufficientEvidence: boolean;
    },
    context: GroundingContext,
  ): Record<string, unknown> {
    return {
      evidenceCoverage: output.evidenceUsed.length > 0 ? 'present' : 'none',
      regulatoryGrounding: context.source ? 'present' : 'absent',
      caseGrounding: context.caseStudy ? 'present' : 'absent',
      reasoningDepth: output.reasoningDimensions.length,
      insufficientEvidenceFlagged: output.insufficientEvidence,
      provenanceCompleteness: [
        context.source,
        context.caseStudy,
        context.observation,
        context.learningObjective,
      ].filter(Boolean).length,
    };
  }
}

const RUN_INCLUDE = {
  initiatedBy: { select: { id: true, email: true } },
  source: { select: { id: true, title: true } },
  caseStudy: { select: { id: true, caseCode: true, title: true } },
  observation: { select: { id: true, observationCode: true } },
  learningObjective: { select: { id: true, description: true } },
  level: { select: { id: true, name: true } },
  module: { select: { id: true, title: true } },
  professionalRole: { select: { id: true, name: true } },
} satisfies Prisma.AiGenerationRunInclude;
