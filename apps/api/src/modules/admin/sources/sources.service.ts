import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, type WorkflowAction } from '@gcp/shared';
import { ContentStatus, type Source } from '@prisma/client';

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
import { type CreateSourceDto } from './dto/create-source.dto';
import { type ListSourcesQueryDto } from './dto/list-sources.query.dto';
import { type UpdateSourceDto } from './dto/update-source.dto';

@Injectable()
export class SourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListSourcesQueryDto): Promise<PaginatedResult<Source>> {
    const where = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { title: containsInsensitive(query.search) },
              { citation: containsInsensitive(query.search) },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.source.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.source.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<Source> {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException('Source not found');
    }
    return source;
  }

  async create(dto: CreateSourceDto, actorId: string): Promise<Source> {
    const source = await this.prisma.source.create({
      data: {
        type: dto.type,
        title: dto.title,
        ...(dto.citation ? { citation: dto.citation } : {}),
        ...(dto.url ? { url: dto.url } : {}),
        ...(dto.publishedOn ? { publishedOn: new Date(dto.publishedOn) } : {}),
        ...(dto.notes ? { notes: dto.notes } : {}),
        retrievedAt: new Date(),
        createdById: actorId,
      },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_CREATED,
      entity: 'source',
      entityId: source.id,
      actorId,
    });

    return source;
  }

  async update(id: string, dto: UpdateSourceDto, actorId: string): Promise<Source> {
    await this.get(id);
    const { publishedOn, ...rest } = dto;

    const updated = await this.prisma.source.update({
      where: { id },
      data: {
        ...rest,
        ...(publishedOn ? { publishedOn: new Date(publishedOn) } : {}),
        version: { increment: 1 },
      },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'source',
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
        'Only DRAFT sources can be permanently deleted — archive it instead.',
      );
    }

    await this.prisma.source.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'source',
      entityId: id,
      actorId,
      metadata: { deleted: true },
    });
  }

  async transition(id: string, action: WorkflowAction, actorId: string): Promise<Source> {
    const existing = await this.get(id);
    const reviewStatus = nextReviewStatus(existing.reviewStatus, action);

    const updated = await this.prisma.source.update({ where: { id }, data: { reviewStatus } });

    await this.audit.record({
      action: auditActionForTransition(action),
      entity: 'source',
      entityId: id,
      actorId,
      metadata: { action, from: existing.reviewStatus, to: reviewStatus },
    });

    return updated;
  }
}
