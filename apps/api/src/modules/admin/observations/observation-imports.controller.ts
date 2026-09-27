import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { PaginationQueryDto } from '../common/pagination.dto';
import { CreateObservationImportDto } from './dto/create-observation-import.dto';
import {
  type CommitImportResult,
  type ImportBatchResult,
  type ImportRowResult,
  ObservationImportsService,
} from './observation-imports.service';

const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

/**
 * Gate 11 §41-45: controlled, dry-run-capable observation import. Every
 * route is CONTENT_AUTHOR/ADMIN-only - a learner or unauthenticated caller
 * can never register or commit an import batch.
 */
@Controller('admin/observation-imports')
export class ObservationImportsController {
  constructor(private readonly imports: ObservationImportsService) {}

  @Roles(WRITE_ROLES)
  @Post()
  createBatch(
    @Body() dto: CreateObservationImportDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ImportBatchResult> {
    return this.imports.createBatch(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Get()
  listBatches(@Query() query: PaginationQueryDto): Promise<PaginatedResult<ImportBatchResult>> {
    return this.imports.listBatches(query.page, query.pageSize);
  }

  @Roles(WRITE_ROLES)
  @Get(':id')
  getBatch(@Param('id') id: string): Promise<ImportBatchResult> {
    return this.imports.getBatch(id);
  }

  @Roles(WRITE_ROLES)
  @Get(':id/preview')
  previewBatch(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<ImportRowResult>> {
    return this.imports.previewBatch(id, query.page, query.pageSize);
  }

  @Roles(WRITE_ROLES)
  @Post(':id/commit')
  commitBatch(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<CommitImportResult> {
    return this.imports.commitBatch(id, user.id);
  }
}
