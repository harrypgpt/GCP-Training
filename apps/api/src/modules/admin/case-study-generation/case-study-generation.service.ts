import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AiErrorCode, AiOperation, AuditAction, CaseStudyGenerationErrorCode } from '@gcp/shared';
import {
  type AiRunStatus,
  CaseStudyEvidenceRole,
  CaseStudyEvidenceType,
  Prisma,
} from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  GroundingService,
  type CaseStudyGroundingContext,
} from '../../ai/grounding/grounding.service';
import {
  AiProviderError,
  type AiProviderRequest,
  type AiProviderResponse,
} from '../../ai/interfaces/ai-types';
import { AiPolicyService } from '../../ai/policies/ai-policy.service';
import { AiProviderFactory } from '../../ai/providers/provider.factory';
import { type GenerateCaseStudyDto } from './dto/generate-case-study.dto';
import {
  buildCaseStudyGenerationPrompt,
  CASE_STUDY_GENERATION_PROMPT_VERSION,
} from './prompts/case-study-generation.prompt';
import {
  CASE_STUDY_OUTPUT_SCHEMA_VERSION,
  caseStudyOutputSchema,
} from './validation/case-study-output.schemas';
import { validateCaseStudyOutput } from './validation/case-study-output.validator';

const GENERATION_RUN_INCLUDE = {
  initiatedBy: { select: { id: true, email: true } },
  caseStudySpecification: { select: { id: true, code: true, title: true, status: true } },
} satisfies Prisma.AiGenerationRunInclude;

export interface GenerationResult {
  runId: string;
  caseStudyId: string;
  versionId: string;
  validationStatus: string;
  versionStatus: string;
}

/**
 * Gate 15 §12/§17/§19/§21: orchestrates one AI case-study generation call.
 * Reuses the existing AiProvider/AiPolicyService/AiProviderFactory/
 * GroundingService/AiGenerationRun infrastructure exactly as
 * `AiGenerationService` does for questions - a SEPARATE service (not an
 * addition to `AiGenerationService`) because the specification-based
 * eligibility/idempotency/evidence-reference concerns here are
 * structurally different, but never a second AI framework: the provider
 * seam, retry policy, and run bookkeeping are the same code shape.
 */
@Injectable()
export class CaseStudyGenerationService {
  private readonly logger = new Logger(CaseStudyGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: AiPolicyService,
    private readonly providers: AiProviderFactory,
    private readonly grounding: GroundingService,
    private readonly config: AppConfigService,
  ) {}

  async generate(
    specificationId: string,
    dto: GenerateCaseStudyDto,
    actorId: string,
  ): Promise<GenerationResult> {
    const spec = await this.loadSpecification(specificationId);

    // Gate 15 §21: one active generation per specification, enforced by an
    // atomic conditional update below - never a check-then-act race.
    if (spec.activeGenerationRunId) {
      const activeRun = await this.prisma.aiGenerationRun.findUnique({
        where: { id: spec.activeGenerationRunId },
      });
      if (activeRun && (activeRun.status === 'PENDING' || activeRun.status === 'RUNNING')) {
        throw new AppException(
          HttpStatus.CONFLICT,
          CaseStudyGenerationErrorCode.GENERATION_ALREADY_IN_PROGRESS,
          'A generation is already in progress for this specification.',
        );
      }
    }
    if (spec.status !== 'READY_FOR_GENERATION' && spec.status !== 'GENERATED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        CaseStudyGenerationErrorCode.INVALID_SPECIFICATION_TRANSITION,
        `Specification must be READY_FOR_GENERATION (run /validate first) - currently ${spec.status}.`,
      );
    }

    this.policy.ensureEnabled();
    const provider = this.providers.getProvider();
    this.policy.ensureProviderAllowed(provider.name);
    const isExternalProvider = this.providers.isExternalProvider(provider.name);

    const context = await this.grounding.buildCaseStudyContext(specificationId, {
      isExternalProvider,
    });

    const run = await this.prisma.aiGenerationRun.create({
      data: {
        operation: AiOperation.CASE_STUDY_GENERATION,
        provider: provider.name,
        model: this.config.ai.model,
        status: 'RUNNING',
        initiatedById: actorId,
        promptTemplateVersion: CASE_STUDY_GENERATION_PROMPT_VERSION,
        groundingVersion: context.version,
        outputSchemaVersion: CASE_STUDY_OUTPUT_SCHEMA_VERSION,
        caseStudySpecificationId: specificationId,
        observationId: context.primaryObservation.observationId,
        ...(context.learningObjective ? { learningObjectiveId: context.learningObjective.id } : {}),
        requestParams: { scenarioType: context.scenarioType } as Prisma.InputJsonValue,
      },
    });

    const claim = await this.prisma.caseStudySpecification.updateMany({
      where: { id: specificationId, activeGenerationRunId: null },
      data: { activeGenerationRunId: run.id, status: 'GENERATION_IN_PROGRESS' },
    });
    if (claim.count === 0) {
      await this.prisma.aiGenerationRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date(), errorCode: 'RACE_LOST' },
      });
      throw new AppException(
        HttpStatus.CONFLICT,
        CaseStudyGenerationErrorCode.GENERATION_ALREADY_IN_PROGRESS,
        'A generation is already in progress for this specification.',
      );
    }

    await this.audit.record({
      action: AuditAction.CASE_STUDY_GENERATION_REQUESTED,
      entity: 'case_study_specification',
      entityId: specificationId,
      actorId,
      metadata: { runId: run.id, provider: provider.name },
    });

    try {
      const prompt = buildCaseStudyGenerationPrompt(context);
      const providerRequest: AiProviderRequest = {
        operation: AiOperation.CASE_STUDY_GENERATION,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        context: {
          ...(dto.simulate ? { simulate: dto.simulate } : {}),
          primaryObservation: {
            id: context.primaryObservation.id,
            label: context.primaryObservation.label,
          },
          domain: context.domain,
          learningObjective: context.learningObjective,
          trainingInterpretation: context.trainingInterpretation,
        },
        maxTokens: 2000,
        temperature: 0.2,
        timeoutMs: 30_000,
      };

      const response = await this.callWithRetry(provider, providerRequest);
      const parsedJson = this.parseJson(response.text);
      const output = caseStudyOutputSchema.parse(parsedJson);
      const quality = validateCaseStudyOutput(output, context);

      const versionStatus =
        quality.status === 'VALIDATION_FAILED' ? 'VALIDATION_FAILED' : 'READY_FOR_REVIEW';

      const { caseStudyId, versionNumber } = await this.resolveCaseStudyIdentity(
        specificationId,
        output.title,
        actorId,
      );

      const version = await this.prisma.caseStudyVersion.create({
        data: {
          caseStudyId,
          versionNumber,
          status: versionStatus,
          generationMethod: 'AI_GENERATED',
          specificationId,
          generationRunId: run.id,
          validationStatus: quality.status,
          validationReport: quality as unknown as Prisma.InputJsonValue,
          title: output.title,
          scenario: output.scenario,
          ...(context.domain ? { domainId: context.domain.id } : {}),
          ...(context.learningObjective
            ? { learningObjectiveId: context.learningObjective.id }
            : {}),
          content: output as unknown as Prisma.InputJsonValue,
          createdById: actorId,
          ...(context.professionalRoles.length > 0
            ? {
                professionalRoles: {
                  createMany: {
                    data: context.professionalRoles.map((r) => ({ professionalRoleId: r.id })),
                  },
                },
              }
            : {}),
        },
      });

      await this.createEvidenceReferences(version.id, context);

      await this.prisma.aiGenerationRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          latencyMs: response.latencyMs,
          ...(response.usage
            ? { tokenUsage: response.usage as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      await this.prisma.caseStudySpecification.update({
        where: { id: specificationId },
        data: { activeGenerationRunId: null, status: 'GENERATED' },
      });

      await this.audit.record({
        action: AuditAction.CASE_STUDY_GENERATION_COMPLETED,
        entity: 'case_study_version',
        entityId: version.id,
        actorId,
        metadata: { runId: run.id, validationStatus: quality.status },
      });
      if (quality.status === 'VALIDATION_FAILED') {
        await this.audit.record({
          action: AuditAction.CASE_STUDY_VALIDATION_FAILED,
          entity: 'case_study_version',
          entityId: version.id,
          actorId,
          metadata: { errors: quality.errors },
        });
      }

      return {
        runId: run.id,
        caseStudyId,
        versionId: version.id,
        validationStatus: quality.status,
        versionStatus,
      };
    } catch (error) {
      await this.handleGenerationFailure(run.id, specificationId, actorId, error);
      throw error;
    }
  }

  async getGenerationRun(
    runId: string,
  ): Promise<Prisma.AiGenerationRunGetPayload<{ include: typeof GENERATION_RUN_INCLUDE }>> {
    const run = await this.prisma.aiGenerationRun.findUnique({
      where: { id: runId },
      include: GENERATION_RUN_INCLUDE,
    });
    if (!run) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AiErrorCode.PROVIDER_UNAVAILABLE,
        'Generation run not found.',
      );
    }
    return run;
  }

  private async loadSpecification(
    id: string,
  ): Promise<Prisma.CaseStudySpecificationGetPayload<Record<string, never>>> {
    const spec = await this.prisma.caseStudySpecification.findUnique({ where: { id } });
    if (!spec) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        CaseStudyGenerationErrorCode.SPECIFICATION_NOT_FOUND,
        'Case-study specification not found.',
      );
    }
    return spec;
  }

  /** Gate 15 §5: a specification's FIRST successful generation creates the
   * CaseStudy identity row; every subsequent generation from the same
   * specification adds another version under that same identity - never a
   * second, disconnected CaseStudy. */
  private async resolveCaseStudyIdentity(
    specificationId: string,
    title: string,
    actorId: string,
  ): Promise<{ caseStudyId: string; versionNumber: number }> {
    const existingVersion = await this.prisma.caseStudyVersion.findFirst({
      where: { specificationId },
      orderBy: { versionNumber: 'desc' },
    });
    if (existingVersion) {
      return {
        caseStudyId: existingVersion.caseStudyId,
        versionNumber: existingVersion.versionNumber + 1,
      };
    }

    const spec = await this.prisma.caseStudySpecification.findUniqueOrThrow({
      where: { id: specificationId },
    });
    const caseStudy = await this.prisma.caseStudy.create({
      data: {
        caseCode: `CS-${spec.code}`,
        title,
        scenario: 'Pending - see current CaseStudyVersion for the full narrative.',
        observation: 'Pending - see current CaseStudyVersion for the full narrative.',
        createdById: actorId,
      },
    });
    return { caseStudyId: caseStudy.id, versionNumber: 1 };
  }

  private async createEvidenceReferences(
    versionId: string,
    context: CaseStudyGroundingContext,
  ): Promise<void> {
    const rows: Prisma.CaseStudyEvidenceReferenceCreateManyInput[] = [
      {
        caseStudyVersionId: versionId,
        evidenceType: CaseStudyEvidenceType.OBSERVATION,
        evidenceRole: CaseStudyEvidenceRole.PRIMARY_OBSERVATION,
        observationId: context.primaryObservation.observationId,
        observationVersionId: context.primaryObservation.id,
        claimText: context.primaryObservation.label,
      },
      ...context.supportingObservations.map(
        (s): Prisma.CaseStudyEvidenceReferenceCreateManyInput => ({
          caseStudyVersionId: versionId,
          evidenceType: CaseStudyEvidenceType.OBSERVATION,
          evidenceRole: CaseStudyEvidenceRole.SOURCE_SUPPORT,
          observationId: s.observationId,
          observationVersionId: s.id,
          claimText: s.label,
        }),
      ),
    ];
    if (context.trainingInterpretation) {
      rows.push({
        caseStudyVersionId: versionId,
        evidenceType: CaseStudyEvidenceType.TRAINING_INTERPRETATION,
        evidenceRole: CaseStudyEvidenceRole.TRAINING_INTERPRETATION,
        trainingInterpretationId: context.trainingInterpretation.id,
        claimText: context.trainingInterpretation.label,
      });
    }
    if (context.learningObjective) {
      rows.push({
        caseStudyVersionId: versionId,
        evidenceType: CaseStudyEvidenceType.LEARNING_OBJECTIVE,
        evidenceRole: CaseStudyEvidenceRole.CONTEXT,
        learningObjectiveId: context.learningObjective.id,
        claimText: context.learningObjective.label,
      });
    }
    if (context.primaryObservation.sourceSectionId) {
      rows.push({
        caseStudyVersionId: versionId,
        evidenceType: CaseStudyEvidenceType.SOURCE_SECTION,
        evidenceRole: CaseStudyEvidenceRole.SOURCE_SUPPORT,
        ...(context.primaryObservation.sourceId
          ? { sourceId: context.primaryObservation.sourceId }
          : {}),
        ...(context.primaryObservation.sourceVersionId
          ? { sourceVersionId: context.primaryObservation.sourceVersionId }
          : {}),
        sourceSectionId: context.primaryObservation.sourceSectionId,
        claimText: `Source section cited by ${context.primaryObservation.label}`,
      });
    }

    await this.prisma.caseStudyEvidenceReference.createMany({ data: rows });
  }

  private async handleGenerationFailure(
    runId: string,
    specificationId: string,
    actorId: string,
    error: unknown,
  ): Promise<void> {
    const { status, errorCode, errorMessage } = this.classifyFailure(error);
    this.logger.warn(`Case-study generation run ${runId} failed: ${errorMessage}`);
    await this.prisma.aiGenerationRun.update({
      where: { id: runId },
      data: { status, completedAt: new Date(), errorCode, errorMessage },
    });
    // Gate 15 §21: a failed generation returns the specification to
    // READY_FOR_GENERATION (never stuck IN_PROGRESS) so a retry is safe.
    await this.prisma.caseStudySpecification.updateMany({
      where: { id: specificationId, activeGenerationRunId: runId },
      data: { activeGenerationRunId: null, status: 'READY_FOR_GENERATION' },
    });
    await this.audit.record({
      action: AuditAction.CASE_STUDY_GENERATION_FAILED,
      entity: 'case_study_specification',
      entityId: specificationId,
      actorId,
      metadata: { runId, errorCode, errorMessage },
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
      errorMessage:
        error instanceof Error ? error.message : 'Unknown case-study generation failure',
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
