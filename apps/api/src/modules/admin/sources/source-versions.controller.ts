import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { CreateSourceVersionDto, UpdateSourceVersionDto } from './dto/create-source-version.dto';
import { CreateSourceVersionRelationshipDto } from './dto/create-source-version-relationship.dto';
import { IngestSourceSectionsDto } from './dto/ingest-sections.dto';
import { ListSourceSectionsQueryDto } from './dto/list-source-sections.query.dto';
import { ListSourceVersionsQueryDto } from './dto/list-source-versions.query.dto';
import {
  type IngestSectionsResult,
  type SourceSectionResult,
  type SourceVersionDetailResult,
  type SourceVersionRelationshipResult,
  type SourceVersionSummaryResult,
  SourceVersionsService,
  WORKFLOW_ACTION_ROLES,
} from './source-versions.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

/**
 * Gate 10: admin management of a Source's versioned, provenance-rich
 * content. Mounted under both `/admin/sources/:sourceId/versions` (nested
 * under the existing Source resource, per Gate 10 spec §33's example) and
 * `/admin/source-versions/:id` (direct access to one version) - the same
 * split the repository already uses for Exam/ExamVersion.
 */
@Controller()
export class SourceVersionsController {
  constructor(private readonly versions: SourceVersionsService) {}

  @Roles(WRITE_ROLES)
  @Post('admin/sources/:sourceId/versions')
  createVersion(
    @Param('sourceId') sourceId: string,
    @Body() dto: CreateSourceVersionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SourceVersionDetailResult> {
    return this.versions.createVersion(sourceId, dto, user.id);
  }

  @Roles(READ_ROLES)
  @Get('admin/sources/:sourceId/versions')
  listVersionsForSource(
    @Param('sourceId') sourceId: string,
    @Query() query: ListSourceVersionsQueryDto,
  ): Promise<PaginatedResult<SourceVersionSummaryResult>> {
    return this.versions.listVersionsForSource(sourceId, query);
  }

  @Roles(READ_ROLES)
  @Get('admin/source-versions/:id')
  getVersion(@Param('id') id: string): Promise<SourceVersionDetailResult> {
    return this.versions.getVersion(id);
  }

  @Roles(WRITE_ROLES)
  @Patch('admin/source-versions/:id')
  updateVersion(
    @Param('id') id: string,
    @Body() dto: UpdateSourceVersionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SourceVersionDetailResult> {
    return this.versions.updateVersion(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Post('admin/source-versions/:id/sections')
  ingestSections(
    @Param('id') id: string,
    @Body() dto: IngestSourceSectionsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<IngestSectionsResult> {
    return this.versions.ingestSections(id, dto, user.id);
  }

  @Roles(READ_ROLES)
  @Get('admin/source-versions/:id/sections')
  listSections(
    @Param('id') id: string,
    @Query() query: ListSourceSectionsQueryDto,
  ): Promise<PaginatedResult<SourceSectionResult>> {
    return this.versions.listSections(id, query);
  }

  @Patch('admin/source-versions/:id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SourceVersionDetailResult> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.versions.transition(id, dto.action, user.id);
  }

  @Roles(WRITE_ROLES)
  @Post('admin/source-versions/:id/relationships')
  createRelationship(
    @Param('id') id: string,
    @Body() dto: CreateSourceVersionRelationshipDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SourceVersionRelationshipResult> {
    return this.versions.createRelationship(id, dto, user.id);
  }

  @Roles(READ_ROLES)
  @Get('admin/source-versions/:id/relationships')
  listRelationships(@Param('id') id: string): Promise<SourceVersionRelationshipResult[]> {
    return this.versions.listRelationships(id);
  }
}
