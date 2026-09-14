import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, type WorkflowAction } from '@gcp/shared';
import { ContentStatus, type TrainingLevel } from '@prisma/client';

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
import { type CreateLevelDto } from './dto/create-level.dto';
import { type ListLevelsQueryDto } from './dto/list-levels.query.dto';
import { type UpdateLevelDto } from './dto/update-level.dto';

@Injectable()
export class LevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListLevelsQueryDto): Promise<PaginatedResult<TrainingLevel>> {
    const where = {
      ...(query.programId ? { programId: query.programId } : {}),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { name: containsInsensitive(query.search) },
              { code: containsInsensitive(query.search) },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.trainingLevel.findMany({
        where,
        orderBy: [{ programId: 'asc' }, { sortOrder: 'asc' }],
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.trainingLevel.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<TrainingLevel> {
    const level = await this.prisma.trainingLevel.findUnique({ where: { id } });
    if (!level) {
      throw new NotFoundException('Training level not found');
    }
    return level;
  }

  async create(dto: CreateLevelDto, actorId: string): Promise<TrainingLevel> {
    const program = await this.prisma.trainingProgram.findUnique({ where: { id: dto.programId } });
    if (!program) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.PARENT_NOT_FOUND,
        'Training program not found.',
      );
    }
    await this.assertCodeAvailable(dto.programId, dto.code);

    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder(dto.programId));

    const level = await this.prisma.trainingLevel.create({
      data: {
        programId: dto.programId,
        code: dto.code,
        name: dto.name,
        ...(dto.description ? { description: dto.description } : {}),
        sortOrder,
        createdById: actorId,
      },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_CREATED,
      entity: 'training_level',
      entityId: level.id,
      actorId,
      metadata: { programId: dto.programId, code: level.code },
    });

    return level;
  }

  async update(id: string, dto: UpdateLevelDto, actorId: string): Promise<TrainingLevel> {
    const existing = await this.get(id);
    if (dto.code && dto.code !== existing.code) {
      await this.assertCodeAvailable(existing.programId, dto.code);
    }

    const updated = await this.prisma.trainingLevel.update({
      where: { id },
      data: { ...dto, version: { increment: 1 } },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'training_level',
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
        'Only DRAFT levels can be permanently deleted — archive it instead.',
      );
    }

    const nonDraftModuleCount = await this.prisma.module.count({
      where: { levelId: id, reviewStatus: { not: ContentStatus.DRAFT } },
    });
    if (nonDraftModuleCount > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.HAS_NON_DRAFT_CHILDREN,
        'This level has modules that are no longer in DRAFT — archive the level instead of deleting it.',
      );
    }

    await this.prisma.trainingLevel.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'training_level',
      entityId: id,
      actorId,
      metadata: { deleted: true },
    });
  }

  async transition(id: string, action: WorkflowAction, actorId: string): Promise<TrainingLevel> {
    const existing = await this.get(id);
    const reviewStatus = nextReviewStatus(existing.reviewStatus, action);

    const updated = await this.prisma.trainingLevel.update({
      where: { id },
      data: { reviewStatus },
    });

    await this.audit.record({
      action: auditActionForTransition(action),
      entity: 'training_level',
      entityId: id,
      actorId,
      metadata: { action, from: existing.reviewStatus, to: reviewStatus },
    });

    return updated;
  }

  async reorder(programId: string, orderedIds: string[], actorId: string): Promise<void> {
    const siblings = await this.prisma.trainingLevel.findMany({
      where: { programId },
      select: { id: true },
    });
    const siblingIds = new Set(siblings.map((s) => s.id));
    const validIds = orderedIds.filter((id) => siblingIds.has(id));
    if (validIds.length !== siblingIds.size || validIds.length !== orderedIds.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.PARENT_NOT_FOUND,
        'orderedIds must contain exactly the set of levels belonging to programId.',
      );
    }

    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.trainingLevel.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'training_level',
      entityId: programId,
      actorId,
      metadata: { reordered: orderedIds },
    });
  }

  private async nextSortOrder(programId: string): Promise<number> {
    const last = await this.prisma.trainingLevel.findFirst({
      where: { programId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }

  private async assertCodeAvailable(programId: string, code: string): Promise<void> {
    const existing = await this.prisma.trainingLevel.findUnique({
      where: { programId_code: { programId, code } },
    });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.CODE_CONFLICT,
        `A level with code "${code}" already exists in this program.`,
      );
    }
  }
}
