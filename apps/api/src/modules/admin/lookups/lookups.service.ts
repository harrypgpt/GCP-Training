import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginatedResult,
  containsInsensitive,
  paginationSkipTake,
  type PaginatedResult,
} from '../common/pagination';
import { type ListLookupQueryDto } from './dto/list-lookup.query.dto';

export interface LookupItem {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/**
 * Read-only listings for the two open vocabularies that Stage 4 deliberately
 * left without admin CRUD (GCP domains, professional roles) — see
 * `docs`/memory note on that decision. The Stage 6A question-bank UI needs
 * *some* way to populate its domain/role filter and form dropdowns without
 * hard-coding a taxonomy, so this adds only the minimal read surface that
 * requires: no create/update/delete here, that remains out of scope.
 */
@Injectable()
export class LookupsService {
  constructor(private readonly prisma: PrismaService) {}

  async listGcpDomains(query: ListLookupQueryDto): Promise<PaginatedResult<LookupItem>> {
    const where = query.search
      ? {
          OR: [
            { name: containsInsensitive(query.search) },
            { code: containsInsensitive(query.search) },
          ],
        }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.gcpDomain.findMany({
        where,
        orderBy: { name: 'asc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.gcpDomain.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async listProfessionalRoles(query: ListLookupQueryDto): Promise<PaginatedResult<LookupItem>> {
    const where = query.search
      ? {
          OR: [
            { name: containsInsensitive(query.search) },
            { code: containsInsensitive(query.search) },
          ],
        }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.professionalRole.findMany({
        where,
        orderBy: { name: 'asc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.professionalRole.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }
}
