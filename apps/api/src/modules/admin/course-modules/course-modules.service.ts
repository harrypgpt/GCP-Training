import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, type WorkflowAction } from '@gcp/shared';
import { ContentStatus, type Module as CourseModule } from '@prisma/client';

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
import { type CreateCourseModuleDto } from './dto/create-course-module.dto';
import { type ListCourseModulesQueryDto } from './dto/list-course-modules.query.dto';
import { type UpdateCourseModuleDto } from './dto/update-course-module.dto';

@Injectable()
export class CourseModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCourseModulesQueryDto): Promise<PaginatedResult<CourseModule>> {
    const where = {
      ...(query.levelId ? { levelId: query.levelId } : {}),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { title: containsInsensitive(query.search) },
              { slug: containsInsensitive(query.search) },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.module.findMany({
        where,
        orderBy: [{ levelId: 'asc' }, { sortOrder: 'asc' }],
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.module.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<CourseModule> {
    const courseModule = await this.prisma.module.findUnique({ where: { id } });
    if (!courseModule) {
      throw new NotFoundException('Module not found');
    }
    return courseModule;
  }

  async create(dto: CreateCourseModuleDto, actorId: string): Promise<CourseModule> {
    const level = await this.prisma.trainingLevel.findUnique({ where: { id: dto.levelId } });
    if (!level) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.PARENT_NOT_FOUND,
        'Training level not found.',
      );
    }
    await this.assertSlugAvailable(dto.levelId, dto.slug);

    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder(dto.levelId));

    const courseModule = await this.prisma.module.create({
      data: {
        levelId: dto.levelId,
        slug: dto.slug,
        title: dto.title,
        ...(dto.description ? { description: dto.description } : {}),
        sortOrder,
        createdById: actorId,
      },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_CREATED,
      entity: 'module',
      entityId: courseModule.id,
      actorId,
      metadata: { levelId: dto.levelId, slug: courseModule.slug },
    });

    return courseModule;
  }

  async update(id: string, dto: UpdateCourseModuleDto, actorId: string): Promise<CourseModule> {
    const existing = await this.get(id);
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugAvailable(existing.levelId, dto.slug);
    }

    const updated = await this.prisma.module.update({
      where: { id },
      data: { ...dto, version: { increment: 1 } },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'module',
      entityId: id,
      actorId,
    });

    return updated;
  }

  async remove(id: string, actorId: string): Promise<void> {
    const existing = await this.get(id);
    if (existing.reviewStatus !== ContentStatus.DRAFT) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.CANNOT_DELETE_NON_DRAFT,
        'Only DRAFT modules can be permanently deleted — archive it instead.',
      );
    }

    const nonDraftLessonCount = await this.prisma.lesson.count({
      where: { moduleId: id, reviewStatus: { not: ContentStatus.DRAFT } },
    });
    if (nonDraftLessonCount > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.HAS_NON_DRAFT_CHILDREN,
        'This module has lessons that are no longer in DRAFT — archive the module instead of deleting it.',
      );
    }

    await this.prisma.module.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'module',
      entityId: id,
      actorId,
      metadata: { deleted: true },
    });
  }

  async transition(id: string, action: WorkflowAction, actorId: string): Promise<CourseModule> {
    const existing = await this.get(id);
    const reviewStatus = nextReviewStatus(existing.reviewStatus, action);

    const updated = await this.prisma.module.update({ where: { id }, data: { reviewStatus } });

    await this.audit.record({
      action: auditActionForTransition(action),
      entity: 'module',
      entityId: id,
      actorId,
      metadata: { action, from: existing.reviewStatus, to: reviewStatus },
    });

    return updated;
  }

  async reorder(levelId: string, orderedIds: string[], actorId: string): Promise<void> {
    const siblings = await this.prisma.module.findMany({
      where: { levelId },
      select: { id: true },
    });
    const siblingIds = new Set(siblings.map((s) => s.id));
    const validIds = orderedIds.filter((id) => siblingIds.has(id));
    if (validIds.length !== siblingIds.size || validIds.length !== orderedIds.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.PARENT_NOT_FOUND,
        'orderedIds must contain exactly the set of modules belonging to levelId.',
      );
    }

    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.module.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'module',
      entityId: levelId,
      actorId,
      metadata: { reordered: orderedIds },
    });
  }

  private async nextSortOrder(levelId: string): Promise<number> {
    const last = await this.prisma.module.findFirst({
      where: { levelId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }

  private async assertSlugAvailable(levelId: string, slug: string): Promise<void> {
    const existing = await this.prisma.module.findUnique({
      where: { levelId_slug: { levelId, slug } },
    });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.SLUG_CONFLICT,
        `A module with slug "${slug}" already exists in this level.`,
      );
    }
  }
}
