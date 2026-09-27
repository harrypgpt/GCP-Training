import { HttpStatus, Injectable } from '@nestjs/common';

import {
  AuditAction,
  CaseStudyGenerationErrorCode,
  ContentErrorCode,
  ObservationErrorCode,
} from '@gcp/shared';
import { CaseStudySpecificationObservationRole, Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginatedResult,
  paginationSkipTake,
  type PaginatedResult,
} from '../common/pagination';
import { CaseStudyEligibilityService } from './case-study-eligibility.service';
import { type CreateCaseStudySpecificationDto } from './dto/create-specification.dto';
import { type ListCaseStudySpecificationsQueryDto } from './dto/list-specifications.query.dto';
import { type UpdateCaseStudySpecificationDto } from './dto/update-specification.dto';

export const SPECIFICATION_INCLUDE = {
  domain: { select: { id: true, code: true, name: true } },
  learningObjective: { select: { id: true, code: true, title: true } },
  primaryObservationVersion: {
    select: { id: true, observationId: true, originalText: true, domainId: true },
  },
  trainingInterpretation: {
    select: { id: true, interpretationType: true, text: true, reviewStatus: true },
  },
  professionalRoles: {
    include: { professionalRole: { select: { id: true, code: true, name: true } } },
  },
  supportingObservations: {
    include: { observationVersion: { select: { id: true, observationId: true } } },
  },
  versions: {
    select: {
      id: true,
      versionNumber: true,
      status: true,
      validationStatus: true,
      createdAt: true,
    },
  },
  createdBy: { select: { id: true, email: true } },
} satisfies Prisma.CaseStudySpecificationInclude;

export type SpecificationWithRelations = Prisma.CaseStudySpecificationGetPayload<{
  include: typeof SPECIFICATION_INCLUDE;
}>;

export interface SpecificationValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Gate 15 §8/§9/§19: the deterministic, server-assembled "recipe" for one
 * case-study scenario. Every reference (domain/role/LO/training
 * interpretation/observations) is validated to actually exist before the
 * specification is created - the browser can never pass an arbitrary ID
 * straight through to a later AI call.
 */
@Injectable()
export class CaseStudySpecificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eligibility: CaseStudyEligibilityService,
  ) {}

  async list(
    query: ListCaseStudySpecificationsQueryDto,
  ): Promise<PaginatedResult<SpecificationWithRelations>> {
    const where: Prisma.CaseStudySpecificationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.scenarioType ? { scenarioType: query.scenarioType } : {}),
      ...(query.domainId ? { domainId: query.domainId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.caseStudySpecification.findMany({
        where,
        include: SPECIFICATION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.caseStudySpecification.count({ where }),
    ]);
    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<SpecificationWithRelations> {
    const spec = await this.prisma.caseStudySpecification.findUnique({
      where: { id },
      include: SPECIFICATION_INCLUDE,
    });
    if (!spec) throw this.notFound();
    return spec;
  }

  async create(
    dto: CreateCaseStudySpecificationDto,
    actorId: string,
  ): Promise<SpecificationWithRelations> {
    await this.assertCodeAvailable(dto.code);

    const eligibility = await this.eligibility.assess(dto.primaryObservationVersionId);
    if (eligibility.state === 'NOT_READY' || eligibility.state === 'NOT_ASSESSED') {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        CaseStudyGenerationErrorCode.OBSERVATION_NOT_ELIGIBLE,
        `The primary observation is not eligible for case-study specification: ${eligibility.reasons.join(' ')}`,
      );
    }

    if (dto.domainId) await this.assertDomainExists(dto.domainId);
    if (dto.learningObjectiveId) await this.assertLearningObjectiveExists(dto.learningObjectiveId);
    if (dto.trainingInterpretationId) {
      await this.assertTrainingInterpretationExists(dto.trainingInterpretationId);
    }
    if (dto.professionalRoleIds?.length) await this.assertRolesExist(dto.professionalRoleIds);
    if (dto.supportingObservationVersionIds?.length) {
      await this.assertObservationVersionsExist(dto.supportingObservationVersionIds);
    }

    const spec = await this.prisma.caseStudySpecification.create({
      data: {
        code: dto.code,
        title: dto.title,
        scenarioType: dto.scenarioType,
        primaryObservationVersionId: dto.primaryObservationVersionId,
        ...(dto.domainId ? { domainId: dto.domainId } : {}),
        ...(dto.learningObjectiveId ? { learningObjectiveId: dto.learningObjectiveId } : {}),
        ...(dto.trainingInterpretationId
          ? { trainingInterpretationId: dto.trainingInterpretationId }
          : {}),
        ...(dto.riskDimensions ? { riskDimensions: dto.riskDimensions } : {}),
        ...(dto.severity ? { severity: dto.severity } : {}),
        ...(dto.rootCauseCategory ? { rootCauseCategory: dto.rootCauseCategory } : {}),
        ...(dto.desiredDecisionPoint ? { desiredDecisionPoint: dto.desiredDecisionPoint } : {}),
        ...(dto.expectedLearnerCompetency
          ? { expectedLearnerCompetency: dto.expectedLearnerCompetency }
          : {}),
        ...(dto.allowedFactualBoundaries
          ? { allowedFactualBoundaries: dto.allowedFactualBoundaries }
          : {}),
        ...(dto.prohibitedAssumptions ? { prohibitedAssumptions: dto.prohibitedAssumptions } : {}),
        createdById: actorId,
        ...(dto.professionalRoleIds?.length
          ? {
              professionalRoles: {
                createMany: {
                  data: dto.professionalRoleIds.map((professionalRoleId) => ({
                    professionalRoleId,
                  })),
                },
              },
            }
          : {}),
        ...(dto.supportingObservationVersionIds?.length
          ? {
              supportingObservations: {
                createMany: {
                  data: dto.supportingObservationVersionIds.map((observationVersionId) => ({
                    observationVersionId,
                    role: CaseStudySpecificationObservationRole.SUPPORTING,
                  })),
                },
              },
            }
          : {}),
      },
    });

    await this.audit.record({
      action: AuditAction.CASE_STUDY_SPECIFICATION_CREATED,
      entity: 'case_study_specification',
      entityId: spec.id,
      actorId,
      metadata: { code: dto.code, scenarioType: dto.scenarioType },
    });

    return this.get(spec.id);
  }

  async update(
    id: string,
    dto: UpdateCaseStudySpecificationDto,
    actorId: string,
  ): Promise<SpecificationWithRelations> {
    const spec = await this.get(id);
    this.assertEditable(spec);

    if (dto.domainId) await this.assertDomainExists(dto.domainId);
    if (dto.learningObjectiveId) await this.assertLearningObjectiveExists(dto.learningObjectiveId);
    if (dto.trainingInterpretationId) {
      await this.assertTrainingInterpretationExists(dto.trainingInterpretationId);
    }
    if (dto.professionalRoleIds) await this.assertRolesExist(dto.professionalRoleIds);

    const { professionalRoleIds, ...scalarChanges } = dto;

    await this.prisma.$transaction(async (tx) => {
      if (professionalRoleIds) {
        await tx.caseStudySpecificationProfessionalRole.deleteMany({
          where: { specificationId: id },
        });
        if (professionalRoleIds.length > 0) {
          await tx.caseStudySpecificationProfessionalRole.createMany({
            data: professionalRoleIds.map((professionalRoleId) => ({
              specificationId: id,
              professionalRoleId,
            })),
          });
        }
      }
      await tx.caseStudySpecification.update({ where: { id }, data: scalarChanges });
    });

    await this.audit.record({
      action: AuditAction.CASE_STUDY_SPECIFICATION_UPDATED,
      entity: 'case_study_specification',
      entityId: id,
      actorId,
    });

    return this.get(id);
  }

  /**
   * Gate 15 §8/§20: a deterministic, non-AI completeness+eligibility check.
   * Never calls a provider. On success, transitions the specification to
   * READY_FOR_GENERATION - a specification can only ever become
   * generation-eligible through this explicit, auditable step.
   */
  async validate(id: string, actorId: string): Promise<SpecificationValidationReport> {
    const spec = await this.get(id);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (spec.status !== 'DRAFT' && spec.status !== 'READY_FOR_GENERATION') {
      errors.push(`Specification is in status ${spec.status} and cannot be (re)validated.`);
    }

    const eligibility = await this.eligibility.assess(spec.primaryObservationVersionId);
    if (!eligibility.eligibleForSpecification && eligibility.state !== 'HUMAN_REVIEW_REQUIRED') {
      errors.push(...eligibility.reasons);
    } else if (eligibility.state === 'HUMAN_REVIEW_REQUIRED') {
      warnings.push(...eligibility.reasons);
    }

    if (!spec.domainId) warnings.push('No domain set on the specification itself.');
    if (spec.professionalRoles.length === 0) {
      warnings.push('No professional role set on the specification itself.');
    }
    if (!spec.desiredDecisionPoint?.trim()) {
      warnings.push('No desired decision point was specified - the AI will have to infer one.');
    }
    // Gate 16 §10/§25 defense-in-depth: re-check on every validation, not
    // only at spec-creation time, in case the linked interpretation was
    // archived (or otherwise left APPROVED) after the specification was
    // created - a stale reference must never silently pass as approved.
    if (spec.trainingInterpretation && spec.trainingInterpretation.reviewStatus !== 'APPROVED') {
      errors.push(
        `The linked training interpretation is in status ${spec.trainingInterpretation.reviewStatus}, not APPROVED - it cannot ground AI generation.`,
      );
    }

    const valid = errors.length === 0;
    if (valid && spec.status === 'DRAFT') {
      await this.prisma.caseStudySpecification.update({
        where: { id },
        data: { status: 'READY_FOR_GENERATION' },
      });
    }

    await this.audit.record({
      action: AuditAction.CASE_STUDY_SPECIFICATION_UPDATED,
      entity: 'case_study_specification',
      entityId: id,
      actorId,
      metadata: { validated: true, valid, errorCount: errors.length },
    });

    return { valid, errors, warnings };
  }

  private assertEditable(spec: SpecificationWithRelations): void {
    if (spec.status !== 'DRAFT') {
      throw new AppException(
        HttpStatus.CONFLICT,
        CaseStudyGenerationErrorCode.SPECIFICATION_NOT_EDITABLE,
        `Specification is in status ${spec.status} and can only be edited while DRAFT.`,
      );
    }
  }

  private notFound(): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      CaseStudyGenerationErrorCode.SPECIFICATION_NOT_FOUND,
      'Case-study specification not found.',
    );
  }

  private async assertCodeAvailable(code: string): Promise<void> {
    const existing = await this.prisma.caseStudySpecification.findUnique({ where: { code } });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.CODE_CONFLICT,
        `A case-study specification with code "${code}" already exists.`,
      );
    }
  }

  private async assertDomainExists(domainId: string): Promise<void> {
    const domain = await this.prisma.gcpDomain.findUnique({ where: { id: domainId } });
    if (!domain) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.DOMAIN_NOT_FOUND,
        'GCP domain not found.',
      );
    }
  }

  private async assertLearningObjectiveExists(learningObjectiveId: string): Promise<void> {
    const lo = await this.prisma.learningObjective.findUnique({
      where: { id: learningObjectiveId },
    });
    if (!lo) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.LEARNING_OBJECTIVE_NOT_FOUND,
        'Learning objective not found.',
      );
    }
  }

  /// Gate 16 §10/§25: existence alone is not enough - only a reviewer-
  /// APPROVED interpretation may ground a specification. A DRAFT/REVIEW
  /// interpretation is unreviewed content and must never be treated as
  /// approved evidence, no matter how complete it looks.
  private async assertTrainingInterpretationExists(
    trainingInterpretationId: string,
  ): Promise<void> {
    const interpretation = await this.prisma.observationTrainingInterpretation.findUnique({
      where: { id: trainingInterpretationId },
    });
    if (!interpretation) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.TRAINING_INTERPRETATION_NOT_FOUND,
        'Training interpretation not found.',
      );
    }
    if (interpretation.reviewStatus !== 'APPROVED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        CaseStudyGenerationErrorCode.TRAINING_INTERPRETATION_NOT_APPROVED,
        `The training interpretation is in status ${interpretation.reviewStatus} and has not been reviewer-approved. Only an APPROVED interpretation may ground a case-study specification.`,
      );
    }
  }

  private async assertRolesExist(professionalRoleIds: string[]): Promise<void> {
    const count = await this.prisma.professionalRole.count({
      where: { id: { in: professionalRoleIds } },
    });
    if (count !== new Set(professionalRoleIds).size) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.PROFESSIONAL_ROLE_NOT_FOUND,
        'One or more professional roles not found.',
      );
    }
  }

  private async assertObservationVersionsExist(observationVersionIds: string[]): Promise<void> {
    const count = await this.prisma.observationVersion.count({
      where: { id: { in: observationVersionIds } },
    });
    if (count !== new Set(observationVersionIds).size) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
        'One or more supporting observation versions not found.',
      );
    }
  }
}
