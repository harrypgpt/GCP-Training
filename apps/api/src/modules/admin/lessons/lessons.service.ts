import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, type WorkflowAction } from '@gcp/shared';
import { ContentStatus, type Lesson } from '@prisma/client';

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
import { type CreateLessonDto } from './dto/create-lesson.dto';
import { type ListLessonsQueryDto } from './dto/list-lessons.query.dto';
import { type UpdateLessonDto } from './dto/update-lesson.dto';

@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListLessonsQueryDto): Promise<PaginatedResult<Lesson>> {
    const where = {
      ...(query.moduleId ? { moduleId: query.moduleId } : {}),
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
      this.prisma.lesson.findMany({
        where,
        orderBy: [{ moduleId: 'asc' }, { sortOrder: 'asc' }],
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.lesson.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<Lesson> {
    const lesson = await this.prisma.lesson.findUnique({ where: { id } });
    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }
    return lesson;
  }

  async create(dto: CreateLessonDto, actorId: string): Promise<Lesson> {
    const courseModule = await this.prisma.module.findUnique({ where: { id: dto.moduleId } });
    if (!courseModule) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.PARENT_NOT_FOUND,
        'Module not found.',
      );
    }
    await this.assertSlugAvailable(dto.moduleId, dto.slug);

    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder(dto.moduleId));

    const lesson = await this.prisma.lesson.create({
      data: {
        moduleId: dto.moduleId,
        slug: dto.slug,
        title: dto.title,
        ...(dto.content ? { content: dto.content } : {}),
        sortOrder,
        createdById: actorId,
      },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_CREATED,
      entity: 'lesson',
      entityId: lesson.id,
      actorId,
      metadata: { moduleId: dto.moduleId, slug: lesson.slug },
    });

    return lesson;
  }

  async update(id: string, dto: UpdateLessonDto, actorId: string): Promise<Lesson> {
    const existing = await this.get(id);
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugAvailable(existing.moduleId, dto.slug);
    }

    const updated = await this.prisma.lesson.update({
      where: { id },
      data: { ...dto, version: { increment: 1 } },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'lesson',
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
        'Only DRAFT lessons can be permanently deleted — archive it instead.',
      );
    }

    const nonDraftObjectiveCount = await this.prisma.learningObjective.count({
      where: { lessonId: id, reviewStatus: { not: ContentStatus.DRAFT } },
    });
    if (nonDraftObjectiveCount > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.HAS_NON_DRAFT_CHILDREN,
        'This lesson has learning objectives that are no longer in DRAFT — archive the lesson instead of deleting it.',
      );
    }

    await this.prisma.lesson.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'lesson',
      entityId: id,
      actorId,
      metadata: { deleted: true },
    });
  }

  async transition(id: string, action: WorkflowAction, actorId: string): Promise<Lesson> {
    const existing = await this.get(id);
    const reviewStatus = nextReviewStatus(existing.reviewStatus, action);

    const updated = await this.prisma.lesson.update({ where: { id }, data: { reviewStatus } });

    await this.audit.record({
      action: auditActionForTransition(action),
      entity: 'lesson',
      entityId: id,
      actorId,
      metadata: { action, from: existing.reviewStatus, to: reviewStatus },
    });

    return updated;
  }

  async reorder(moduleId: string, orderedIds: string[], actorId: string): Promise<void> {
    const siblings = await this.prisma.lesson.findMany({
      where: { moduleId },
      select: { id: true },
    });
    const siblingIds = new Set(siblings.map((s) => s.id));
    const validIds = orderedIds.filter((id) => siblingIds.has(id));
    if (validIds.length !== siblingIds.size || validIds.length !== orderedIds.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.PARENT_NOT_FOUND,
        'orderedIds must contain exactly the set of lessons belonging to moduleId.',
      );
    }

    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.lesson.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'lesson',
      entityId: moduleId,
      actorId,
      metadata: { reordered: orderedIds },
    });
  }

  private async nextSortOrder(moduleId: string): Promise<number> {
    const last = await this.prisma.lesson.findFirst({
      where: { moduleId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }

  private async assertSlugAvailable(moduleId: string, slug: string): Promise<void> {
    const existing = await this.prisma.lesson.findUnique({
      where: { moduleId_slug: { moduleId, slug } },
    });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.SLUG_CONFLICT,
        `A lesson with slug "${slug}" already exists in this module.`,
      );
    }
  }
}
