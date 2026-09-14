import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, type WorkflowAction } from '@gcp/shared';
import { ContentStatus, type LearningObjective } from '@prisma/client';

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
import { type CreateObjectiveDto } from './dto/create-objective.dto';
import { type ListObjectivesQueryDto } from './dto/list-objectives.query.dto';
import { type UpdateObjectiveDto } from './dto/update-objective.dto';

@Injectable()
export class ObjectivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListObjectivesQueryDto): Promise<PaginatedResult<LearningObjective>> {
    const where = {
      ...(query.lessonId ? { lessonId: query.lessonId } : {}),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.search ? { description: containsInsensitive(query.search) } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.learningObjective.findMany({
        where,
        orderBy: [{ lessonId: 'asc' }, { sortOrder: 'asc' }],
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.learningObjective.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<LearningObjective> {
    const objective = await this.prisma.learningObjective.findUnique({ where: { id } });
    if (!objective) {
      throw new NotFoundException('Learning objective not found');
    }
    return objective;
  }

  async create(dto: CreateObjectiveDto, actorId: string): Promise<LearningObjective> {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: dto.lessonId } });
    if (!lesson) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.PARENT_NOT_FOUND,
        'Lesson not found.',
      );
    }

    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder(dto.lessonId));

    const objective = await this.prisma.learningObjective.create({
      data: {
        lessonId: dto.lessonId,
        description: dto.description,
        sortOrder,
        createdById: actorId,
      },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_CREATED,
      entity: 'learning_objective',
      entityId: objective.id,
      actorId,
      metadata: { lessonId: dto.lessonId },
    });

    return objective;
  }

  async update(id: string, dto: UpdateObjectiveDto, actorId: string): Promise<LearningObjective> {
    await this.get(id);

    const updated = await this.prisma.learningObjective.update({
      where: { id },
      data: { ...dto, version: { increment: 1 } },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'learning_objective',
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
        'Only DRAFT learning objectives can be permanently deleted — archive it instead.',
      );
    }

    await this.prisma.learningObjective.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'learning_objective',
      entityId: id,
      actorId,
      metadata: { deleted: true },
    });
  }

  async transition(
    id: string,
    action: WorkflowAction,
    actorId: string,
  ): Promise<LearningObjective> {
    const existing = await this.get(id);
    const reviewStatus = nextReviewStatus(existing.reviewStatus, action);

    const updated = await this.prisma.learningObjective.update({
      where: { id },
      data: { reviewStatus },
    });

    await this.audit.record({
      action: auditActionForTransition(action),
      entity: 'learning_objective',
      entityId: id,
      actorId,
      metadata: { action, from: existing.reviewStatus, to: reviewStatus },
    });

    return updated;
  }

  async reorder(lessonId: string, orderedIds: string[], actorId: string): Promise<void> {
    const siblings = await this.prisma.learningObjective.findMany({
      where: { lessonId },
      select: { id: true },
    });
    const siblingIds = new Set(siblings.map((s) => s.id));
    const validIds = orderedIds.filter((id) => siblingIds.has(id));
    if (validIds.length !== siblingIds.size || validIds.length !== orderedIds.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.PARENT_NOT_FOUND,
        'orderedIds must contain exactly the set of learning objectives belonging to lessonId.',
      );
    }

    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.learningObjective.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'learning_objective',
      entityId: lessonId,
      actorId,
      metadata: { reordered: orderedIds },
    });
  }

  private async nextSortOrder(lessonId: string): Promise<number> {
    const last = await this.prisma.learningObjective.findFirst({
      where: { lessonId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }
}
