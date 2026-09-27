import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { CreateObservationVersionDto } from './dto/create-observation-version.dto';
import { ExternalAiEligibilityDecisionDto } from './dto/external-ai-eligibility-decision.dto';
import { ListObservationVersionsQueryDto } from './dto/list-observation-versions.query.dto';
import { UpdateObservationVersionDto } from './dto/update-observation-version.dto';
import {
  type ExternalAiEligibilityResult,
  ObservationExternalAiEligibilityService,
} from './observation-external-ai-eligibility.service';
import {
  type ObservationVersionDetailResult,
  type ObservationVersionSummaryResult,
  ObservationVersionsService,
  WORKFLOW_ACTION_ROLES,
} from './observation-versions.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];
/** Gate 20 §8: same roles the generic workflow uses for APPROVE - external-AI
 * eligibility is a reviewer/admin governance decision, never a content-author one. */
const EXTERNAL_AI_ELIGIBILITY_ROLES = [UserRole.REVIEWER, UserRole.ADMIN];

/**
 * Gate 11: admin management of an Observation's versioned, evidence-rich
 * content. Mounted under both `/admin/observations/:observationId/versions`
 * (nested, mirroring Gate 10's Source/SourceVersion split) and
 * `/admin/observation-versions/:id` (direct access to one version).
 */
@Controller()
export class ObservationVersionsController {
  constructor(
    private readonly versions: ObservationVersionsService,
    private readonly externalAiEligibility: ObservationExternalAiEligibilityService,
  ) {}

  @Roles(WRITE_ROLES)
  @Post('admin/observations/:observationId/versions')
  createVersion(
    @Param('observationId') observationId: string,
    @Body() dto: CreateObservationVersionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ObservationVersionDetailResult> {
    return this.versions.createVersion(observationId, dto, user.id);
  }

  @Roles(READ_ROLES)
  @Get('admin/observations/:observationId/versions')
  listVersionsForObservation(
    @Param('observationId') observationId: string,
    @Query() query: ListObservationVersionsQueryDto,
  ): Promise<PaginatedResult<ObservationVersionSummaryResult>> {
    return this.versions.listVersionsForObservation(observationId, query);
  }

  @Roles(READ_ROLES)
  @Get('admin/observation-versions/:id')
  getVersion(@Param('id') id: string): Promise<ObservationVersionDetailResult> {
    return this.versions.getVersion(id);
  }

  @Roles(WRITE_ROLES)
  @Patch('admin/observation-versions/:id')
  updateVersion(
    @Param('id') id: string,
    @Body() dto: UpdateObservationVersionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ObservationVersionDetailResult> {
    return this.versions.updateVersion(id, dto, user.id);
  }

  @Patch('admin/observation-versions/:id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ObservationVersionDetailResult> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.versions.transition(id, dto.action, user.id);
  }

  @Roles(EXTERNAL_AI_ELIGIBILITY_ROLES)
  @Patch('admin/observation-versions/:id/external-ai-eligibility')
  decideExternalAiEligibility(
    @Param('id') id: string,
    @Body() dto: ExternalAiEligibilityDecisionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ExternalAiEligibilityResult> {
    return this.externalAiEligibility.decide(id, dto, user.id);
  }
}
