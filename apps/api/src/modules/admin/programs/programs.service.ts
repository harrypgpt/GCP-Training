import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, type WorkflowAction } from '@gcp/shared';
import { ContentStatus, type TrainingProgram } from '@prisma/client';

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
import { type CreateProgramDto } from './dto/create-program.dto';
import { type ListProgramsQueryDto } from './dto/list-programs.query.dto';
import { type UpdateProgramDto } from './dto/update-program.dto';

@Injectable()
export class ProgramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListProgramsQueryDto): Promise<PaginatedResult<TrainingProgram>> {
    const where = {
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
      this.prisma.trainingProgram.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.trainingProgram.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<TrainingProgram> {
    const program = await this.prisma.trainingProgram.findUnique({ where: { id } });
    if (!program) {
      throw new NotFoundException('Training program not found');
    }
    return program;
  }

  async create(dto: CreateProgramDto, actorId: string): Promise<TrainingProgram> {
    await this.assertSlugAvailable(dto.slug);

    const program = await this.prisma.trainingProgram.create({
      data: { ...dto, createdById: actorId },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_CREATED,
      entity: 'training_program',
      entityId: program.id,
      actorId,
      metadata: { slug: program.slug },
    });

    return program;
  }

  async update(id: string, dto: UpdateProgramDto, actorId: string): Promise<TrainingProgram> {
    const existing = await this.get(id);
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugAvailable(dto.slug);
    }

    const updated = await this.prisma.trainingProgram.update({
      where: { id },
      data: { ...dto, version: { increment: 1 } },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'training_program',
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
        'Only DRAFT programs can be permanently deleted — archive it instead.',
      );
    }

    const nonDraftLevelCount = await this.prisma.trainingLevel.count({
      where: { programId: id, reviewStatus: { not: ContentStatus.DRAFT } },
    });
    if (nonDraftLevelCount > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.HAS_NON_DRAFT_CHILDREN,
        'This program has levels that are no longer in DRAFT — archive the program instead of deleting it.',
      );
    }

    await this.prisma.trainingProgram.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'training_program',
      entityId: id,
      actorId,
      metadata: { deleted: true },
    });
  }

  async transition(id: string, action: WorkflowAction, actorId: string): Promise<TrainingProgram> {
    const existing = await this.get(id);
    const reviewStatus = nextReviewStatus(existing.reviewStatus, action);

    const updated = await this.prisma.trainingProgram.update({
      where: { id },
      data: { reviewStatus },
    });

    await this.audit.record({
      action: auditActionForTransition(action),
      entity: 'training_program',
      entityId: id,
      actorId,
      metadata: { action, from: existing.reviewStatus, to: reviewStatus },
    });

    return updated;
  }

  private async assertSlugAvailable(slug: string): Promise<void> {
    const existing = await this.prisma.trainingProgram.findUnique({ where: { slug } });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.SLUG_CONFLICT,
        `A program with slug "${slug}" already exists.`,
      );
    }
  }
}
