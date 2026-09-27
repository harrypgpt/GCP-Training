import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, QuestionErrorCode, type WorkflowAction } from '@gcp/shared';
import { ContentStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginatedResult,
  containsInsensitive,
  paginationSkipTake,
  type PaginatedResult,
} from '../common/pagination';
import { nextReviewStatus } from '../common/workflow';
import { type CreateQuestionDto } from './dto/create-question.dto';
import { type ListQuestionsQueryDto } from './dto/list-questions.query.dto';
import { type UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionCodeService } from './question-code.service';
import { QuestionDuplicatesService } from './question-duplicates.service';
import { assessQuestionQuality, type QuestionQualityReport } from './question-quality';

const VERSION_DETAIL_INCLUDE = {
  level: { select: { id: true, name: true } },
  domain: { select: { id: true, name: true } },
  professionalRole: { select: { id: true, name: true } },
  learningObjective: { select: { id: true, description: true } },
  observation: { select: { id: true, observationCode: true, description: true } },
  source: { select: { id: true, title: true } },
  sourceSectionRef: { select: { id: true, sectionIdentifier: true, heading: true } },
  author: { select: { id: true, email: true } },
  reviewer: { select: { id: true, email: true } },
  options: { orderBy: { sortOrder: 'asc' } },
  caseStudyLinks: {
    include: { caseStudy: { select: { id: true, caseCode: true, title: true } } },
  },
} satisfies Prisma.QuestionVersionInclude;

type VersionWithRelations = Prisma.QuestionVersionGetPayload<{
  include: typeof VERSION_DETAIL_INCLUDE;
}>;

export interface QuestionOptionView {
  id: string;
  label: string;
  content: string;
  isCorrect: boolean;
  explanation: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface QuestionVersionSummary {
  id: string;
  versionNumber: number;
  reviewStatus: ContentStatus;
  isCurrentPublished: boolean;
  createdAt: Date;
  approvedAt: Date | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  author: { id: string; email: string } | null;
  reviewer: { id: string; email: string } | null;
}

export interface QuestionVersionDetail extends QuestionVersionSummary {
  questionId: string;
  type: string;
  stem: string;
  instructions: string | null;
  explanation: string | null;
  rationale: string | null;
  difficulty: string;
  isActive: boolean;
  level: { id: string; name: string } | null;
  domain: { id: string; name: string } | null;
  professionalRole: { id: string; name: string } | null;
  learningObjective: { id: string; description: string } | null;
  observation: { id: string; observationCode: string; description: string } | null;
  source: { id: string; title: string } | null;
  sourceSection: string | null;
  sourceSectionRef: { id: string; sectionIdentifier: string; heading: string | null } | null;
  questionGenerationType: string | null;
  caseStudies: { id: string; caseCode: string; title: string }[];
  options: QuestionOptionView[];
  author: { id: string; email: string } | null;
  reviewer: { id: string; email: string } | null;
  quality: QuestionQualityReport;
}

export interface QuestionDetail {
  id: string;
  code: string;
  createdAt: Date;
  updatedAt: Date;
  currentPublishedVersionId: string | null;
  latestVersion: QuestionVersionDetail;
  versions: QuestionVersionSummary[];
}

export interface QuestionListItem {
  id: string;
  code: string;
  currentPublishedVersionId: string | null;
  updatedAt: Date;
  latestVersion: {
    id: string;
    versionNumber: number;
    type: string;
    stem: string;
    difficulty: string;
    reviewStatus: ContentStatus;
    isActive: boolean;
    level: { id: string; name: string } | null;
    domain: { id: string; name: string } | null;
    author: { id: string; email: string } | null;
    reviewer: { id: string; email: string } | null;
    /** Gate 22 §34: surfaced as a list column so the normative ICH
     * reference doesn't require opening the detail page to see. */
    sourceSectionRef: { id: string; sectionIdentifier: string } | null;
    questionGenerationType: string | null;
    caseStudyCount: number;
  };
}

@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: QuestionCodeService,
    private readonly duplicates: QuestionDuplicatesService,
  ) {}

  async list(query: ListQuestionsQueryDto): Promise<PaginatedResult<QuestionListItem>> {
    const latestIdRows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (question_id) id
      FROM question_versions
      ORDER BY question_id, version_number DESC
    `;
    const latestIds = latestIdRows.map((r) => r.id);

    const where: Prisma.QuestionVersionWhereInput = {
      id: { in: latestIds },
      ...(query.type ? { type: query.type } : {}),
      ...(query.difficulty ? { difficulty: query.difficulty } : {}),
      ...(query.levelId ? { levelId: query.levelId } : {}),
      ...(query.domainId ? { domainId: query.domainId } : {}),
      ...(query.professionalRoleId ? { professionalRoleId: query.professionalRoleId } : {}),
      ...(query.learningObjectiveId ? { learningObjectiveId: query.learningObjectiveId } : {}),
      ...(query.sourceId ? { sourceId: query.sourceId } : {}),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.caseStudyId
        ? { caseStudyLinks: { some: { caseStudyId: query.caseStudyId } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { stem: containsInsensitive(query.search) },
              { question: { code: containsInsensitive(query.search) } },
            ],
          }
        : {}),
    };

    const [versions, total] = await this.prisma.$transaction([
      this.prisma.questionVersion.findMany({
        where,
        include: {
          question: {
            select: { id: true, code: true, currentPublishedVersionId: true, updatedAt: true },
          },
          level: { select: { id: true, name: true } },
          domain: { select: { id: true, name: true } },
          author: { select: { id: true, email: true } },
          reviewer: { select: { id: true, email: true } },
          sourceSectionRef: { select: { id: true, sectionIdentifier: true } },
          _count: { select: { caseStudyLinks: true } },
        },
        orderBy: { updatedAt: 'desc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.questionVersion.count({ where }),
    ]);

    const items: QuestionListItem[] = versions.map((v) => ({
      id: v.question.id,
      code: v.question.code,
      currentPublishedVersionId: v.question.currentPublishedVersionId,
      updatedAt: v.question.updatedAt,
      latestVersion: {
        id: v.id,
        versionNumber: v.versionNumber,
        type: v.type,
        stem: v.stem,
        difficulty: v.difficulty,
        reviewStatus: v.reviewStatus,
        isActive: v.isActive,
        level: v.level,
        domain: v.domain,
        author: v.author,
        reviewer: v.reviewer,
        sourceSectionRef: v.sourceSectionRef,
        questionGenerationType: v.questionGenerationType,
        caseStudyCount: v._count.caseStudyLinks,
      },
    }));

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<QuestionDetail> {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            reviewStatus: true,
            createdAt: true,
            approvedAt: true,
            publishedAt: true,
            archivedAt: true,
            author: { select: { id: true, email: true } },
            reviewer: { select: { id: true, email: true } },
          },
        },
      },
    });
    if (!question || question.versions.length === 0) {
      throw new NotFoundException('Question not found');
    }

    const latestSummary = question.versions[0];
    if (!latestSummary) {
      throw new NotFoundException('Question not found');
    }
    const latestVersion = await this.loadVersionDetail(latestSummary.id);
    latestVersion.isCurrentPublished = latestVersion.id === question.currentPublishedVersionId;

    return {
      id: question.id,
      code: question.code,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
      currentPublishedVersionId: question.currentPublishedVersionId,
      latestVersion,
      versions: question.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        reviewStatus: v.reviewStatus,
        isCurrentPublished: v.id === question.currentPublishedVersionId,
        createdAt: v.createdAt,
        approvedAt: v.approvedAt,
        publishedAt: v.publishedAt,
        archivedAt: v.archivedAt,
        author: v.author,
        reviewer: v.reviewer,
      })),
    };
  }

  async getVersion(questionId: string, versionId: string): Promise<QuestionVersionDetail> {
    const version = await this.prisma.questionVersion.findFirst({
      where: { id: versionId, questionId },
      include: { question: { select: { currentPublishedVersionId: true } } },
    });
    if (!version) {
      throw new NotFoundException('Question version not found');
    }
    const detail = await this.loadVersionDetail(versionId);
    detail.isCurrentPublished = versionId === version.question.currentPublishedVersionId;
    return detail;
  }

  async create(dto: CreateQuestionDto, actorId: string): Promise<QuestionDetail> {
    await this.assertReferencesExist(dto);
    this.validateOptionSet(dto.options);

    const code = await this.codes.nextCode();

    const question = await this.prisma.$transaction(async (tx) => {
      const created = await tx.question.create({ data: { code } });
      await tx.questionVersion.create({
        data: {
          questionId: created.id,
          versionNumber: 1,
          type: dto.type,
          stem: dto.stem,
          ...(dto.instructions !== undefined ? { instructions: dto.instructions } : {}),
          ...(dto.explanation !== undefined ? { explanation: dto.explanation } : {}),
          ...(dto.rationale !== undefined ? { rationale: dto.rationale } : {}),
          ...(dto.difficulty !== undefined ? { difficulty: dto.difficulty } : {}),
          ...(dto.levelId !== undefined ? { levelId: dto.levelId } : {}),
          ...(dto.domainId !== undefined ? { domainId: dto.domainId } : {}),
          ...(dto.professionalRoleId !== undefined
            ? { professionalRoleId: dto.professionalRoleId }
            : {}),
          ...(dto.learningObjectiveId !== undefined
            ? { learningObjectiveId: dto.learningObjectiveId }
            : {}),
          ...(dto.observationId !== undefined ? { observationId: dto.observationId } : {}),
          ...(dto.sourceId !== undefined ? { sourceId: dto.sourceId } : {}),
          ...(dto.sourceSection !== undefined ? { sourceSection: dto.sourceSection } : {}),
          ...(dto.sourceSectionRefId !== undefined
            ? { sourceSectionRefId: dto.sourceSectionRefId }
            : {}),
          ...(dto.questionGenerationType !== undefined
            ? { questionGenerationType: dto.questionGenerationType }
            : {}),
          authorId: actorId,
          options: {
            create: dto.options.map((o, index) => ({
              label: o.label,
              content: o.content,
              isCorrect: o.isCorrect,
              explanation: o.explanation ?? null,
              sortOrder: o.sortOrder ?? index,
            })),
          },
          ...(dto.caseStudyIds && dto.caseStudyIds.length > 0
            ? { caseStudyLinks: { create: dto.caseStudyIds.map((id) => ({ caseStudyId: id })) } }
            : {}),
        },
      });
      return created;
    });

    await this.audit.record({
      action: AuditAction.QUESTION_CREATED,
      entity: 'question',
      entityId: question.id,
      actorId,
      metadata: { code },
    });

    return this.get(question.id);
  }

  async update(id: string, dto: UpdateQuestionDto, actorId: string): Promise<QuestionDetail> {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: { options: true, caseStudyLinks: true },
        },
      },
    });
    const latest = question?.versions[0];
    if (!question || !latest) {
      throw new NotFoundException('Question not found');
    }

    if (
      latest.reviewStatus === ContentStatus.REVIEW ||
      latest.reviewStatus === ContentStatus.APPROVED
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        QuestionErrorCode.VERSION_NOT_EDITABLE,
        'This question is awaiting or has passed review. Reject it back to DRAFT before editing.',
      );
    }

    await this.assertReferencesExist(dto);
    const mergedOptions =
      dto.options ??
      latest.options.map((o) => ({
        label: o.label,
        content: o.content,
        isCorrect: o.isCorrect,
        ...(o.explanation !== null ? { explanation: o.explanation } : {}),
        sortOrder: o.sortOrder,
      }));
    this.validateOptionSet(mergedOptions);

    const caseStudyIds = dto.caseStudyIds ?? latest.caseStudyLinks.map((l) => l.caseStudyId);

    const fields = {
      type: dto.type ?? latest.type,
      stem: dto.stem ?? latest.stem,
      instructions: dto.instructions ?? latest.instructions,
      explanation: dto.explanation ?? latest.explanation,
      rationale: dto.rationale ?? latest.rationale,
      difficulty: dto.difficulty ?? latest.difficulty,
      levelId: dto.levelId ?? latest.levelId,
      domainId: dto.domainId ?? latest.domainId,
      professionalRoleId: dto.professionalRoleId ?? latest.professionalRoleId,
      learningObjectiveId: dto.learningObjectiveId ?? latest.learningObjectiveId,
      observationId: dto.observationId ?? latest.observationId,
      sourceId: dto.sourceId ?? latest.sourceId,
      sourceSection: dto.sourceSection ?? latest.sourceSection,
    };

    const isDraft = latest.reviewStatus === ContentStatus.DRAFT;

    if (isDraft) {
      await this.prisma.$transaction(async (tx) => {
        await tx.questionVersion.update({ where: { id: latest.id }, data: fields });
        await tx.questionOption.deleteMany({ where: { questionVersionId: latest.id } });
        await tx.questionOption.createMany({
          data: mergedOptions.map((o, index) => ({
            questionVersionId: latest.id,
            label: o.label,
            content: o.content,
            isCorrect: o.isCorrect,
            explanation: o.explanation ?? null,
            sortOrder: o.sortOrder ?? index,
          })),
        });
        await tx.questionCaseStudyLink.deleteMany({ where: { questionVersionId: latest.id } });
        if (caseStudyIds.length > 0) {
          await tx.questionCaseStudyLink.createMany({
            data: caseStudyIds.map((caseStudyId) => ({
              questionVersionId: latest.id,
              caseStudyId,
            })),
          });
        }
      });

      await this.audit.record({
        action: AuditAction.QUESTION_UPDATED,
        entity: 'question',
        entityId: id,
        actorId,
      });
    } else {
      const newVersionNumber = latest.versionNumber + 1;
      await this.prisma.$transaction(async (tx) => {
        await tx.questionVersion.create({
          data: {
            questionId: id,
            versionNumber: newVersionNumber,
            ...fields,
            authorId: actorId,
            options: {
              create: mergedOptions.map((o, index) => ({
                label: o.label,
                content: o.content,
                isCorrect: o.isCorrect,
                explanation: o.explanation ?? null,
                sortOrder: o.sortOrder ?? index,
              })),
            },
            ...(caseStudyIds.length > 0
              ? { caseStudyLinks: { create: caseStudyIds.map((caseStudyId) => ({ caseStudyId })) } }
              : {}),
          },
        });
      });

      await this.audit.record({
        action: AuditAction.QUESTION_VERSION_CREATED,
        entity: 'question',
        entityId: id,
        actorId,
        metadata: { versionNumber: newVersionNumber, precedingVersionId: latest.id },
      });
    }

    return this.get(id);
  }

  async transition(id: string, action: WorkflowAction, actorId: string): Promise<QuestionDetail> {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { versionNumber: 'desc' }, take: 1, include: { options: true } },
      },
    });
    const latest = question?.versions[0];
    if (!question || !latest) {
      throw new NotFoundException('Question not found');
    }

    const nextStatus = nextReviewStatus(latest.reviewStatus, action);

    if (nextStatus === ContentStatus.REVIEW || nextStatus === ContentStatus.PUBLISHED) {
      const quality = assessQuestionQuality({
        stem: latest.stem,
        options: latest.options,
        learningObjectiveId: latest.learningObjectiveId,
        sourceId: latest.sourceId,
        observationId: latest.observationId,
        explanation: latest.explanation,
      });
      if (quality.issues.length > 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          QuestionErrorCode.QUALITY_CHECK_FAILED,
          `This question cannot proceed: ${quality.issues.join(' ')}`,
        );
      }
    }

    const now = new Date();
    const data: Prisma.QuestionVersionUpdateInput = { reviewStatus: nextStatus };
    if (action === 'APPROVE') {
      data.approvedAt = now;
      data.reviewer = { connect: { id: actorId } };
    } else if (action === 'PUBLISH') {
      data.publishedAt = now;
    } else if (action === 'ARCHIVE') {
      data.archivedAt = now;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.questionVersion.update({ where: { id: latest.id }, data });
      if (action === 'PUBLISH') {
        await tx.question.update({
          where: { id },
          data: { currentPublishedVersionId: latest.id },
        });
      }
    });

    if (action === 'SUBMIT_FOR_REVIEW') {
      await this.duplicates.detectAndFlag(latest.id);
    }

    await this.audit.record({
      action: this.auditActionForQuestionTransition(action),
      entity: 'question',
      entityId: id,
      actorId,
      metadata: { action, versionId: latest.id, from: latest.reviewStatus, to: nextStatus },
    });

    return this.get(id);
  }

  async remove(id: string, actorId: string): Promise<void> {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: { versions: { select: { id: true, reviewStatus: true } } },
    });
    if (!question) {
      throw new NotFoundException('Question not found');
    }
    const onlyVersion = question.versions.length === 1 ? question.versions[0] : undefined;
    if (!onlyVersion || onlyVersion.reviewStatus !== ContentStatus.DRAFT) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.CANNOT_DELETE_NON_DRAFT,
        'Only a question with a single DRAFT version can be permanently deleted — archive it instead.',
      );
    }

    await this.prisma.question.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.QUESTION_UPDATED,
      entity: 'question',
      entityId: id,
      actorId,
      metadata: { deleted: true },
    });
  }

  async listDuplicateFlags(includeResolved: boolean): Promise<
    {
      id: string;
      matchType: string;
      detectedAt: Date;
      resolvedAt: Date | null;
      resolutionNote: string | null;
      versionA: { id: string; questionId: string; stem: string; questionCode: string };
      versionB: { id: string; questionId: string; stem: string; questionCode: string };
    }[]
  > {
    const flags = await this.prisma.questionDuplicateFlag.findMany({
      where: includeResolved ? {} : { resolvedAt: null },
      orderBy: { detectedAt: 'desc' },
      include: {
        versionA: { include: { question: { select: { code: true } } } },
        versionB: { include: { question: { select: { code: true } } } },
      },
    });

    return flags.map((f) => ({
      id: f.id,
      matchType: f.matchType,
      detectedAt: f.detectedAt,
      resolvedAt: f.resolvedAt,
      resolutionNote: f.resolutionNote,
      versionA: {
        id: f.versionA.id,
        questionId: f.versionA.questionId,
        stem: f.versionA.stem,
        questionCode: f.versionA.question.code,
      },
      versionB: {
        id: f.versionB.id,
        questionId: f.versionB.questionId,
        stem: f.versionB.stem,
        questionCode: f.versionB.question.code,
      },
    }));
  }

  async resolveDuplicateFlag(
    flagId: string,
    resolutionNote: string | undefined,
    actorId: string,
  ): Promise<void> {
    const flag = await this.prisma.questionDuplicateFlag.findUnique({ where: { id: flagId } });
    if (!flag) {
      throw new NotFoundException('Duplicate flag not found');
    }
    await this.prisma.questionDuplicateFlag.update({
      where: { id: flagId },
      data: {
        resolvedAt: new Date(),
        resolvedById: actorId,
        ...(resolutionNote !== undefined ? { resolutionNote } : {}),
      },
    });
  }

  async preview(id: string): Promise<{ admin: QuestionVersionDetail; learner: unknown }> {
    const detail = await this.get(id);
    const admin = detail.latestVersion;
    const learner = {
      id: admin.id,
      type: admin.type,
      stem: admin.stem,
      instructions: admin.instructions,
      difficulty: admin.difficulty,
      options: admin.options
        .filter((o) => o.isActive)
        .map((o) => ({ id: o.id, label: o.label, content: o.content, sortOrder: o.sortOrder })),
      caseStudies: admin.caseStudies,
    };
    return { admin, learner };
  }

  private validateOptionSet(options: { label: string; isCorrect: boolean }[]): void {
    if (options.length < 2) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        QuestionErrorCode.INSUFFICIENT_OPTIONS,
        'A question must have at least two answer options.',
      );
    }
    const labels = options.map((o) => o.label.toUpperCase());
    if (new Set(labels).size !== labels.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        QuestionErrorCode.OPTION_LABEL_CONFLICT,
        'Answer option labels must be unique within a question.',
      );
    }
    const correctCount = options.filter((o) => o.isCorrect).length;
    if (correctCount === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        QuestionErrorCode.NO_CORRECT_ANSWER,
        'Exactly one answer option must be marked correct.',
      );
    }
    if (correctCount > 1) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        QuestionErrorCode.MULTIPLE_CORRECT_ANSWERS,
        'Only one answer option may be marked correct (single-best-answer questions).',
      );
    }
  }

  private async assertReferencesExist(dto: {
    levelId?: string;
    domainId?: string;
    professionalRoleId?: string;
    learningObjectiveId?: string;
    observationId?: string;
    sourceId?: string;
    sourceSectionRefId?: string;
    caseStudyIds?: string[];
  }): Promise<void> {
    const checks: [string | undefined, () => Promise<unknown>, string][] = [
      [
        dto.levelId,
        () => this.prisma.trainingLevel.findUnique({ where: { id: dto.levelId! } }),
        'Training level not found.',
      ],
      [
        dto.domainId,
        () => this.prisma.gcpDomain.findUnique({ where: { id: dto.domainId! } }),
        'GCP domain not found.',
      ],
      [
        dto.professionalRoleId,
        () => this.prisma.professionalRole.findUnique({ where: { id: dto.professionalRoleId! } }),
        'Professional role not found.',
      ],
      [
        dto.learningObjectiveId,
        () => this.prisma.learningObjective.findUnique({ where: { id: dto.learningObjectiveId! } }),
        'Learning objective not found.',
      ],
      [
        dto.observationId,
        () => this.prisma.observation.findUnique({ where: { id: dto.observationId! } }),
        'Observation not found.',
      ],
      [
        dto.sourceId,
        () => this.prisma.source.findUnique({ where: { id: dto.sourceId! } }),
        'Source not found.',
      ],
      [
        dto.sourceSectionRefId,
        () => this.prisma.sourceSection.findUnique({ where: { id: dto.sourceSectionRefId! } }),
        'Source section not found.',
      ],
    ];

    for (const [value, loader, message] of checks) {
      if (value && !(await loader())) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ContentErrorCode.REFERENCE_NOT_FOUND,
          message,
        );
      }
    }

    if (dto.caseStudyIds && dto.caseStudyIds.length > 0) {
      const found = await this.prisma.caseStudy.findMany({
        where: { id: { in: dto.caseStudyIds } },
        select: { id: true },
      });
      if (found.length !== new Set(dto.caseStudyIds).size) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ContentErrorCode.REFERENCE_NOT_FOUND,
          'One or more case studies were not found.',
        );
      }
    }
  }

  private auditActionForQuestionTransition(action: WorkflowAction): AuditAction {
    switch (action) {
      case 'SUBMIT_FOR_REVIEW':
        return AuditAction.QUESTION_SUBMITTED_FOR_REVIEW;
      case 'APPROVE':
        return AuditAction.QUESTION_APPROVED;
      case 'REJECT':
        return AuditAction.QUESTION_REJECTED;
      case 'PUBLISH':
        return AuditAction.QUESTION_PUBLISHED;
      case 'ARCHIVE':
        return AuditAction.QUESTION_ARCHIVED;
      case 'RESTORE':
      default:
        return AuditAction.QUESTION_UPDATED;
    }
  }

  private async loadVersionDetail(versionId: string): Promise<QuestionVersionDetail> {
    const version = await this.prisma.questionVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: VERSION_DETAIL_INCLUDE,
    });
    return this.toVersionDetail(version);
  }

  private toVersionDetail(version: VersionWithRelations): QuestionVersionDetail {
    const quality = assessQuestionQuality({
      stem: version.stem,
      options: version.options,
      learningObjectiveId: version.learningObjectiveId,
      sourceId: version.sourceId,
      observationId: version.observationId,
      caseStudyLinkCount: version.caseStudyLinks.length,
      explanation: version.explanation,
    });

    return {
      id: version.id,
      questionId: version.questionId,
      versionNumber: version.versionNumber,
      reviewStatus: version.reviewStatus,
      isCurrentPublished: false,
      type: version.type,
      stem: version.stem,
      instructions: version.instructions,
      explanation: version.explanation,
      rationale: version.rationale,
      difficulty: version.difficulty,
      isActive: version.isActive,
      level: version.level,
      domain: version.domain,
      professionalRole: version.professionalRole,
      learningObjective: version.learningObjective,
      observation: version.observation,
      source: version.source,
      sourceSection: version.sourceSection,
      sourceSectionRef: version.sourceSectionRef,
      questionGenerationType: version.questionGenerationType,
      caseStudies: version.caseStudyLinks.map((l) => l.caseStudy),
      options: version.options.map((o) => ({
        id: o.id,
        label: o.label,
        content: o.content,
        isCorrect: o.isCorrect,
        explanation: o.explanation,
        sortOrder: o.sortOrder,
        isActive: o.isActive,
      })),
      author: version.author,
      reviewer: version.reviewer,
      createdAt: version.createdAt,
      approvedAt: version.approvedAt,
      publishedAt: version.publishedAt,
      archivedAt: version.archivedAt,
      quality,
    };
  }
}
