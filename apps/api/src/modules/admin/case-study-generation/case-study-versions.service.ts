import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditAction, CaseStudyGenerationErrorCode, ObservationErrorCode } from '@gcp/shared';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { type CreateCaseStudyVersionDto } from './dto/create-case-study-version.dto';
import { type ReviewCaseStudyVersionDto } from './dto/review-case-study-version.dto';

export const VERSION_INCLUDE = {
  domain: { select: { id: true, code: true, name: true } },
  learningObjective: { select: { id: true, code: true, title: true } },
  professionalRoles: {
    include: { professionalRole: { select: { id: true, code: true, name: true } } },
  },
  evidenceReferences: true,
  specification: { select: { id: true, code: true, scenarioType: true } },
  generationRun: {
    select: {
      id: true,
      provider: true,
      model: true,
      promptTemplateVersion: true,
      status: true,
      createdAt: true,
    },
  },
  reviewer: { select: { id: true, email: true } },
  createdBy: { select: { id: true, email: true } },
} satisfies Prisma.CaseStudyVersionInclude;

export type VersionWithRelations = Prisma.CaseStudyVersionGetPayload<{
  include: typeof VERSION_INCLUDE;
}>;

const REVIEWABLE_STATUSES = new Set(['READY_FOR_REVIEW', 'IN_REVIEW']);

/**
 * Gate 15 §6/§22: human-authored version creation and the mandatory human
 * review workflow. Mirrors the Gate 11/13 immutability rule exactly - once
 * a version reaches APPROVED/PUBLISHED/ARCHIVED it can never be mutated in
 * place; a correction requires a new version.
 */
@Injectable()
export class CaseStudyVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listForCaseStudy(caseStudyId: string): Promise<VersionWithRelations[]> {
    return this.prisma.caseStudyVersion.findMany({
      where: { caseStudyId },
      include: VERSION_INCLUDE,
      orderBy: { versionNumber: 'desc' },
    });
  }

  async get(caseStudyId: string, versionId: string): Promise<VersionWithRelations> {
    const version = await this.prisma.caseStudyVersion.findUnique({
      where: { id: versionId },
      include: VERSION_INCLUDE,
    });
    // IDOR-safe: a version belonging to a different case study looks
    // identical to a nonexistent one - never confirms cross-resource existence.
    if (!version || version.caseStudyId !== caseStudyId) {
      throw this.notFound();
    }
    return version;
  }

  async createHumanAuthored(
    caseStudyId: string,
    dto: CreateCaseStudyVersionDto,
    actorId: string,
  ): Promise<VersionWithRelations> {
    const caseStudy = await this.prisma.caseStudy.findUnique({ where: { id: caseStudyId } });
    if (!caseStudy) throw this.notFound();

    if (dto.domainId) {
      const domain = await this.prisma.gcpDomain.findUnique({ where: { id: dto.domainId } });
      if (!domain) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ObservationErrorCode.DOMAIN_NOT_FOUND,
          'GCP domain not found.',
        );
      }
    }
    if (dto.learningObjectiveId) {
      const lo = await this.prisma.learningObjective.findUnique({
        where: { id: dto.learningObjectiveId },
      });
      if (!lo) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ObservationErrorCode.LEARNING_OBJECTIVE_NOT_FOUND,
          'Learning objective not found.',
        );
      }
    }
    if (dto.professionalRoleIds?.length) {
      const count = await this.prisma.professionalRole.count({
        where: { id: { in: dto.professionalRoleIds } },
      });
      if (count !== new Set(dto.professionalRoleIds).size) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ObservationErrorCode.PROFESSIONAL_ROLE_NOT_FOUND,
          'One or more professional roles not found.',
        );
      }
    }

    const last = await this.prisma.caseStudyVersion.findFirst({
      where: { caseStudyId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const content = {
      title: dto.title,
      scenario: dto.scenario,
      context: dto.context,
      setting: dto.setting,
      participantRoles: dto.participantRoles ?? [],
      situation: dto.situation,
      observedIssue: dto.observedIssue,
      decisionPoint: dto.decisionPoint,
      evidencePresentedToLearner: dto.evidencePresentedToLearner ?? [],
      learnerTask: dto.learnerTask,
      expectedCompetency: dto.expectedCompetency,
      educationalRationale: dto.educationalRationale,
      factualBoundaryStatements: [],
      assumptions: [],
      generatedLimitations: [],
      qualityWarnings: [],
      evidenceUsed: [],
      insufficientEvidence: false,
    };

    const version = await this.prisma.caseStudyVersion.create({
      data: {
        caseStudyId,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        status: 'DRAFT',
        generationMethod: 'HUMAN_AUTHORED',
        validationStatus: 'NOT_VALIDATED',
        title: dto.title,
        scenario: dto.scenario,
        ...(dto.domainId ? { domainId: dto.domainId } : {}),
        ...(dto.learningObjectiveId ? { learningObjectiveId: dto.learningObjectiveId } : {}),
        content: content as unknown as Prisma.InputJsonValue,
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
      },
    });

    return this.get(caseStudyId, version.id);
  }

  /**
   * Gate 15 §22: the mandatory human review decision. AI never reaches
   * APPROVED through any other path - this is the single gate.
   */
  async review(
    caseStudyId: string,
    versionId: string,
    dto: ReviewCaseStudyVersionDto,
    actorId: string,
  ): Promise<VersionWithRelations> {
    const version = await this.get(caseStudyId, versionId);
    if (!REVIEWABLE_STATUSES.has(version.status) && dto.decision !== 'REQUEST_REVISION') {
      throw new AppException(
        HttpStatus.CONFLICT,
        CaseStudyGenerationErrorCode.INVALID_CASE_STUDY_VERSION_TRANSITION,
        `Cannot review a version in status ${version.status}.`,
      );
    }

    const nextStatus =
      dto.decision === 'APPROVE' ? 'APPROVED' : dto.decision === 'REJECT' ? 'ARCHIVED' : 'DRAFT';

    await this.prisma.caseStudyVersion.update({
      where: { id: versionId },
      data: {
        status: nextStatus,
        reviewerId: actorId,
        reviewedAt: new Date(),
        ...(dto.notes ? { reviewNotes: dto.notes } : {}),
        ...(nextStatus === 'ARCHIVED' ? { archivedAt: new Date() } : {}),
      },
    });

    await this.audit.record({
      action:
        dto.decision === 'APPROVE'
          ? AuditAction.CASE_STUDY_APPROVED
          : dto.decision === 'REJECT'
            ? AuditAction.CASE_STUDY_REJECTED
            : AuditAction.CASE_STUDY_REVISION_REQUESTED,
      entity: 'case_study_version',
      entityId: versionId,
      actorId,
      metadata: { decision: dto.decision, notes: dto.notes },
    });

    return this.get(caseStudyId, versionId);
  }

  /// Gate 15 §22: a reviewer explicitly claims a candidate for review -
  /// purely informational (who is looking at this now), never a lock.
  async startReview(
    caseStudyId: string,
    versionId: string,
    actorId: string,
  ): Promise<VersionWithRelations> {
    const version = await this.get(caseStudyId, versionId);
    if (version.status !== 'READY_FOR_REVIEW') {
      throw new AppException(
        HttpStatus.CONFLICT,
        CaseStudyGenerationErrorCode.INVALID_CASE_STUDY_VERSION_TRANSITION,
        `Cannot start review on a version in status ${version.status}.`,
      );
    }
    await this.prisma.caseStudyVersion.update({
      where: { id: versionId },
      data: { status: 'IN_REVIEW' },
    });
    await this.audit.record({
      action: AuditAction.CASE_STUDY_REVIEW_STARTED,
      entity: 'case_study_version',
      entityId: versionId,
      actorId,
    });
    return this.get(caseStudyId, versionId);
  }

  /// Gate 15 §7: only an APPROVED version may be published - moves
  /// CaseStudy.currentPublishedVersionId forward, never mutating the
  /// version it used to point to.
  async publish(
    caseStudyId: string,
    versionId: string,
    actorId: string,
  ): Promise<VersionWithRelations> {
    const version = await this.get(caseStudyId, versionId);
    if (version.status !== 'APPROVED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        CaseStudyGenerationErrorCode.INVALID_CASE_STUDY_VERSION_TRANSITION,
        `Cannot publish a version in status ${version.status} - it must be APPROVED first.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.caseStudyVersion.update({
        where: { id: versionId },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      }),
      this.prisma.caseStudy.update({
        where: { id: caseStudyId },
        data: { currentPublishedVersionId: versionId },
      }),
    ]);

    await this.audit.record({
      action: AuditAction.CASE_STUDY_PUBLISHED,
      entity: 'case_study_version',
      entityId: versionId,
      actorId,
    });

    return this.get(caseStudyId, versionId);
  }

  private notFound(): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      CaseStudyGenerationErrorCode.CASE_STUDY_VERSION_NOT_FOUND,
      'Case-study version not found.',
    );
  }
}
