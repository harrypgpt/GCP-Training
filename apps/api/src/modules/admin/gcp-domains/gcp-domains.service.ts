import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, ObservationErrorCode } from '@gcp/shared';
import { type GcpDomain, type GcpDomainRoleMap } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginatedResult,
  type PaginatedResult,
  paginationSkipTake,
} from '../common/pagination';
import { type CreateDomainRoleMapDto } from './dto/create-domain-role-map.dto';
import { type CreateDomainDto } from './dto/create-domain.dto';
import { type ListDomainsQueryDto } from './dto/list-domains.query.dto';
import { type UpdateDomainDto } from './dto/update-domain.dto';

export interface DomainRoleMapEntryResult extends GcpDomainRoleMap {
  domainCode: string;
  domainName: string;
  professionalRoleCode: string;
  professionalRoleName: string;
}

/**
 * Gate 14 §8/§9/§36/§37: controlled GCP knowledge-taxonomy governance.
 * GcpDomain already existed (Gate 4/11) as a flat reference vocabulary -
 * this service adds the create/update/retire lifecycle Gate 4 never built,
 * plus the Role-to-Domain reference matrix (Gate 14 §11). Never deletes a
 * domain - retirement is `isActive = false`, matching the existing
 * ProfessionalRole convention exactly.
 */
@Injectable()
export class GcpDomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListDomainsQueryDto): Promise<PaginatedResult<GcpDomain>> {
    const where = {
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.gcpDomain.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.gcpDomain.count({ where }),
    ]);
    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<GcpDomain> {
    const domain = await this.prisma.gcpDomain.findUnique({ where: { id } });
    if (!domain) throw new NotFoundException('GCP domain not found');
    return domain;
  }

  async create(dto: CreateDomainDto, actorId: string): Promise<GcpDomain> {
    await this.assertCodeAvailable(dto.code);
    const domain = await this.prisma.gcpDomain.create({
      data: {
        code: dto.code,
        name: dto.name,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.record({
      action: AuditAction.GCP_DOMAIN_CREATED,
      entity: 'gcp_domain',
      entityId: domain.id,
      actorId,
      metadata: { code: dto.code },
    });
    return domain;
  }

  async update(id: string, dto: UpdateDomainDto, actorId: string): Promise<GcpDomain> {
    await this.get(id);
    const updated = await this.prisma.gcpDomain.update({ where: { id }, data: { ...dto } });
    await this.audit.record({
      action: AuditAction.GCP_DOMAIN_UPDATED,
      entity: 'gcp_domain',
      entityId: id,
      actorId,
    });
    return updated;
  }

  /// Gate 14 §37: never deletes a domain that may already be referenced by
  /// observations/case studies/learning objectives - retirement only.
  async retire(id: string, actorId: string): Promise<GcpDomain> {
    const domain = await this.get(id);
    const updated = await this.prisma.gcpDomain.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.record({
      action: AuditAction.GCP_DOMAIN_RETIRED,
      entity: 'gcp_domain',
      entityId: id,
      actorId,
      metadata: { wasActive: domain.isActive },
    });
    return updated;
  }

  async restore(id: string, actorId: string): Promise<GcpDomain> {
    await this.get(id);
    const updated = await this.prisma.gcpDomain.update({
      where: { id },
      data: { isActive: true },
    });
    await this.audit.record({
      action: AuditAction.GCP_DOMAIN_UPDATED,
      entity: 'gcp_domain',
      entityId: id,
      actorId,
      metadata: { restored: true },
    });
    return updated;
  }

  // --- Role-to-domain matrix (Gate 14 §11) - a curated reference view,
  // never a permission system. ----------------------------------------------

  async listRoleMap(domainId?: string): Promise<DomainRoleMapEntryResult[]> {
    const entries = await this.prisma.gcpDomainRoleMap.findMany({
      where: domainId ? { domainId } : {},
      include: { domain: true, professionalRole: true },
      orderBy: [{ domain: { sortOrder: 'asc' } }, { professionalRole: { name: 'asc' } }],
    });
    return entries.map((entry) => ({
      ...entry,
      domainCode: entry.domain.code,
      domainName: entry.domain.name,
      professionalRoleCode: entry.professionalRole.code,
      professionalRoleName: entry.professionalRole.name,
    }));
  }

  async createRoleMapEntry(
    dto: CreateDomainRoleMapDto,
    actorId: string,
  ): Promise<DomainRoleMapEntryResult> {
    const [domain, role] = await Promise.all([
      this.prisma.gcpDomain.findUnique({ where: { id: dto.domainId } }),
      this.prisma.professionalRole.findUnique({ where: { id: dto.professionalRoleId } }),
    ]);
    if (!domain) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.DOMAIN_NOT_FOUND,
        'GCP domain not found.',
      );
    }
    if (!role) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ObservationErrorCode.PROFESSIONAL_ROLE_NOT_FOUND,
        'Professional role not found.',
      );
    }
    const existing = await this.prisma.gcpDomainRoleMap.findUnique({
      where: {
        domainId_professionalRoleId: {
          domainId: dto.domainId,
          professionalRoleId: dto.professionalRoleId,
        },
      },
    });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ObservationErrorCode.GCP_DOMAIN_ROLE_MAP_ALREADY_EXISTS,
        'This domain/role mapping already exists.',
      );
    }

    const entry = await this.prisma.gcpDomainRoleMap.create({
      data: {
        domainId: dto.domainId,
        professionalRoleId: dto.professionalRoleId,
        ...(dto.rationale !== undefined ? { rationale: dto.rationale } : {}),
        createdById: actorId,
      },
      include: { domain: true, professionalRole: true },
    });
    await this.audit.record({
      action: AuditAction.GCP_DOMAIN_ROLE_MAP_CHANGED,
      entity: 'gcp_domain_role_map',
      entityId: entry.id,
      actorId,
      metadata: { domainId: dto.domainId, professionalRoleId: dto.professionalRoleId, added: true },
    });
    return {
      ...entry,
      domainCode: entry.domain.code,
      domainName: entry.domain.name,
      professionalRoleCode: entry.professionalRole.code,
      professionalRoleName: entry.professionalRole.name,
    };
  }

  async removeRoleMapEntry(id: string, actorId: string): Promise<void> {
    const entry = await this.prisma.gcpDomainRoleMap.findUnique({ where: { id } });
    if (!entry) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ObservationErrorCode.GCP_DOMAIN_ROLE_MAP_NOT_FOUND,
        'Domain/role mapping not found.',
      );
    }
    await this.prisma.gcpDomainRoleMap.delete({ where: { id } });
    await this.audit.record({
      action: AuditAction.GCP_DOMAIN_ROLE_MAP_CHANGED,
      entity: 'gcp_domain_role_map',
      entityId: id,
      actorId,
      metadata: {
        domainId: entry.domainId,
        professionalRoleId: entry.professionalRoleId,
        removed: true,
      },
    });
  }

  private async assertCodeAvailable(code: string): Promise<void> {
    const existing = await this.prisma.gcpDomain.findUnique({ where: { code } });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ContentErrorCode.CODE_CONFLICT,
        `A GCP domain with code "${code}" already exists.`,
      );
    }
  }
}
