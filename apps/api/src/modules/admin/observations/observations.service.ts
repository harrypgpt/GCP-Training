import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, type WorkflowAction } from '@gcp/shared';
import { ContentStatus, type Observation } from '@prisma/client';

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
import { type CreateObservationDto } from './dto/create-observation.dto';
import { type ListObservationsQueryDto } from './dto/list-observations.query.dto';
import { type UpdateObservationDto } from './dto/update-observation.dto';

@Injectable()
export class ObservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListObservationsQueryDto): Promise<PaginatedResult<Observation>> {
    const where = {
      ...(query.domainId ? { domainId: query.domainId } : {}),
      ...(query.caseStudyId ? { caseStudyId: query.caseStudyId } : {}),
      ...(query.riskCategory ? { riskCategory: query.riskCategory } : {}),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { description: containsInsensitive(query.search) },
              { observationCode: containsInsensitive(query.search) },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.observation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.observation.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<Observation> {
    const observation = await this.prisma.observation.findUnique({ where: { id } });
    if (!observation) {
      throw new NotFoundException('Observation not found');
    }
    return observation;
  }

  async create(dto: CreateObservationDto, actorId: string): Promise<Observation> {
    await this.assertCodeAvailable(dto.observationCode);
    await this.assertReferencesExist(dto);

    const observation = await this.prisma.observation.create({
      data: { ...dto, createdById: actorId },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_CREATED,
      entity: 'observation',
      entityId: observation.id,
      actorId,
      metadata: { observationCode: observation.observationCode },
    });

    return observation;
  }

  async update(id: string, dto: UpdateObservationDto, actorId: string): Promise<Observation> {
    const existing = await this.get(id);
    if (dto.observationCode && dto.observationCode !== existing.observationCode) {
      await this.assertCodeAvailable(dto.observationCode);
    }
    await this.assertReferencesExist(dto);

    const updated = await this.prisma.observation.update({
      where: { id },
      data: { ...dto, version: { increment: 1 } },
    });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'observation',
      entityId: id,
      actorId,
    });

    return updated;
  }

  async setActive(id: string, isActive: boolean, actorId: string): Promise<Observation> {
    await this.get(id);
    const updated = await this.prisma.observation.update({ where: { id }, data: { isActive } });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'observation',
      entityId: id,
      actorId,
      metadata: { isActive },
    });

    return updated;
  }

  async remove(id: string, actorId: string): Promise<void> {
    const existing = await this.get(id);
    if (existing.reviewStatus !== ContentStatus.DRAFT) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.CANNOT_DELETE_NON_DRAFT,
        'Only DRAFT observations can be permanently deleted — archive it instead.',
      );
    }

    await this.prisma.observation.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.CONTENT_MODIFIED,
      entity: 'observation',
      entityId: id,
      actorId,
      metadata: { deleted: true },
    });
  }

  async transition(id: string, action: WorkflowAction, actorId: string): Promise<Observation> {
    const existing = await this.get(id);
    const reviewStatus = nextReviewStatus(existing.reviewStatus, action);

    const updated = await this.prisma.observation.update({ where: { id }, data: { reviewStatus } });

    await this.audit.record({
      action: auditActionForTransition(action),
      entity: 'observation',
      entityId: id,
      actorId,
      metadata: { action, from: existing.reviewStatus, to: reviewStatus },
    });

    return updated;
  }

  private async assertReferencesExist(dto: {
    caseStudyId?: string;
    domainId?: string;
    sourceId?: string;
  }): Promise<void> {
    if (
      dto.caseStudyId &&
      !(await this.prisma.caseStudy.findUnique({ where: { id: dto.caseStudyId } }))
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.REFERENCE_NOT_FOUND,
        'Case study not found.',
      );
    }
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
    if (dto.sourceId && !(await this.prisma.source.findUnique({ where: { id: dto.sourceId } }))) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.REFERENCE_NOT_FOUND,
        'Source not found.',
      );
    }
  }

  private async assertCodeAvailable(observationCode: string): Promise<void> {
    const existing = await this.prisma.observation.findUnique({ where: { observationCode } });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.CODE_CONFLICT,
        `An observation with code "${observationCode}" already exists.`,
      );
    }
  }
}
