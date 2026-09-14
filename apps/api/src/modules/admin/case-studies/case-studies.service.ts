import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, type WorkflowAction } from '@gcp/shared';
import { type CaseStudy, ContentStatus } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginatedResult,
  type PaginatedResult,
  paginationSkipTake,
  containsInsensitive,
} from '../common/pagination';
import { auditActionForTransition, nextReviewStatus } from '../common/workflow';
import { type CreateCaseStudyDto } from './dto/create-case-study.dto';
import { type ListCaseStudiesQueryDto } from './dto/list-case-studies.query.dto';
import { type UpdateCaseStudyDto } from './dto/update-case-study.dto';

type CaseStudyWithTags = CaseStudy & { tags: { tag: { id: string; name: string } }[] };

const INCLUDE_TAGS = { tags: { include: { tag: true } } } as const;

@Injectable()
export class CaseStudiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCaseStudiesQueryDto): Promise<PaginatedResult<CaseStudyWithTags>> {
    const where = {
      ...(query.domainId ? { domainId: query.domainId } : {}),
      ...(query.professionalRoleId ? { professionalRoleId: query.professionalRoleId } : {}),
      ...(query.riskCategory ? { riskCategory: query.riskCategory } : {}),
      ...(query.difficulty ? { difficulty: query.difficulty } : {}),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: containsInsensitive(query.search) },
              { caseCode: containsInsensitive(query.search) },
              { scenario: containsInsensitive(query.search) },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.caseStudy.findMany({
        where,
        include: INCLUDE_TAGS,
        orderBy: { createdAt: 'desc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.caseStudy.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<CaseStudyWithTags> {
    const caseStudy = await this.prisma.caseStudy.findUnique({
      where: { id },
      include: INCLUDE_TAGS,
    });
    if (!caseStudy) {
      throw new NotFoundException('Case study not found');
    }
    return caseStudy;
  }

  async create(dto: CreateCaseStudyDto, actorId: string): Promise<CaseStudyWithTags> {
    await this.assertCodeAvailable(dto.caseCode);
    await this.assertReferencesExist(dto);

    const { tags, ...fields } = dto;
    const caseStudy = await this.prisma.caseStudy.create({
      data: { ...fields, createdById: actorId },
    });

    if (tags) {
      await this.syncTags(caseStudy.id, tags);
    }

    await this.audit.record({
      action: AuditAction.CONTENT_CREATED,
      entity: 'case_study',
      entityId: caseStudy.id,
      actorId,
      metadata: { caseCode: caseStudy.caseCode },
    });

    return this.get(caseStudy.id);
  }

  async update(id: string, dto: UpdateCaseStudyDto, actorId: string): Promise<CaseStudyWithTags> {
    const existing = await this.get(id);
    if (dto.caseCode && dto.caseCode !== existing.caseCode) {
      await this.assertCodeAvailable(dto.caseCode);
    }
    await this.assertReferencesExist(dto);

    const { tags, ...fields } = dto;
    await this.prisma.caseStudy.update({
      where: { id },
      data: { ...fields, version: { increment: 1 } },
    });

    if (tags) {
      await this.syncTags(id, tags);
    }

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'case_study',
      entityId: id,
      actorId,
    });

    return this.get(id);
  }

  async setActive(id: string, isActive: boolean, actorId: string): Promise<CaseStudyWithTags> {
    await this.get(id);
    await this.prisma.caseStudy.update({ where: { id }, data: { isActive } });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'case_study',
      entityId: id,
      actorId,
      metadata: { isActive },
    });

    return this.get(id);
  }

  async remove(id: string, actorId: string): Promise<void> {
    const existing = await this.get(id);
    if (existing.reviewStatus !== ContentStatus.DRAFT) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.CANNOT_DELETE_NON_DRAFT,
        'Only DRAFT case studies can be permanently deleted — archive it instead.',
      );
    }

    await this.prisma.caseStudy.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'case_study',
      entityId: id,
      actorId,
      metadata: { deleted: true },
    });
  }

  async transition(
    id: string,
    action: WorkflowAction,
    actorId: string,
  ): Promise<CaseStudyWithTags> {
    const existing = await this.get(id);
    const reviewStatus = nextReviewStatus(existing.reviewStatus, action);

    await this.prisma.caseStudy.update({ where: { id }, data: { reviewStatus } });

    await this.audit.record({
      action: auditActionForTransition(action),
      entity: 'case_study',
      entityId: id,
      actorId,
      metadata: { action, from: existing.reviewStatus, to: reviewStatus },
    });

    return this.get(id);
  }

  private async syncTags(caseStudyId: string, tagNames: string[]): Promise<void> {
    const normalized = [
      ...new Set(tagNames.map((name) => name.trim()).filter((name) => name.length > 0)),
    ];

    const tags = await Promise.all(
      normalized.map((name) =>
        this.prisma.tag.upsert({ where: { name }, update: {}, create: { name } }),
      ),
    );
    const tagIds = tags.map((tag) => tag.id);

    await this.prisma.$transaction([
      this.prisma.caseStudyTag.deleteMany({ where: { caseStudyId, tagId: { notIn: tagIds } } }),
      ...tagIds.map((tagId) =>
        this.prisma.caseStudyTag.upsert({
          where: { caseStudyId_tagId: { caseStudyId, tagId } },
          update: {},
          create: { caseStudyId, tagId },
        }),
      ),
    ]);
  }

  private async assertReferencesExist(dto: {
    domainId?: string;
    professionalRoleId?: string;
    learningObjectiveId?: string;
    sourceId?: string;
  }): Promise<void> {
    if (
      dto.domainId &&
      !(await this.prisma.gcpDomain.findUnique({ where: { id: dto.domainId } }))
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.REFERENCE_NOT_FOUND,
        'GCP domain not found.',
      );
    }
    if (
      dto.professionalRoleId &&
      !(await this.prisma.professionalRole.findUnique({ where: { id: dto.professionalRoleId } }))
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.REFERENCE_NOT_FOUND,
        'Professional role not found.',
      );
    }
    if (
      dto.learningObjectiveId &&
      !(await this.prisma.learningObjective.findUnique({ where: { id: dto.learningObjectiveId } }))
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.REFERENCE_NOT_FOUND,
        'Learning objective not found.',
      );
    }
    if (dto.sourceId && !(await this.prisma.source.findUnique({ where: { id: dto.sourceId } }))) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.REFERENCE_NOT_FOUND,
        'Source not found.',
      );
    }
  }

  private async assertCodeAvailable(caseCode: string): Promise<void> {
    const existing = await this.prisma.caseStudy.findUnique({ where: { caseCode } });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.CODE_CONFLICT,
        `A case study with case ID "${caseCode}" already exists.`,
      );
    }
  }
}
