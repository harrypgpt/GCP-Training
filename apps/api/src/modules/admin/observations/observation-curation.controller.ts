import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { PaginationQueryDto } from '../common/pagination.dto';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { BulkCurationDto } from './dto/bulk-curation.dto';
import { ClaimCurationBatchDto } from './dto/claim-curation-batch.dto';
import { CreateSourceLinkReviewDto } from './dto/create-source-link-review.dto';
import { CreateTrainingInterpretationDto } from './dto/create-training-interpretation.dto';
import { CurateDomainDto } from './dto/curate-domain.dto';
import { CurateLearningObjectiveDto } from './dto/curate-learning-objective.dto';
import { CurateProfessionalRolesDto } from './dto/curate-professional-roles.dto';
import { CurateReadinessDto } from './dto/curate-readiness.dto';
import { CurateRiskDimensionsDto } from './dto/curate-risk-dimensions.dto';
import { CurateRootCauseDto } from './dto/curate-root-cause.dto';
import { CurateSeverityDto } from './dto/curate-severity.dto';
import { CurationWorkflowTransitionDto } from './dto/curation-workflow-transition.dto';
import { DecideSourceLinkReviewDto } from './dto/decide-source-link-review.dto';
import { ListObservationCurationQueueQueryDto } from './dto/list-observation-curation-queue.query.dto';
import { ReleaseCurationClaimDto } from './dto/release-curation-claim.dto';
import { UpdateTrainingInterpretationDto } from './dto/update-training-interpretation.dto';
import { CURATION_WORKFLOW_ACTION_ROLES } from './curation-workflow';
import {
  type CurationClaimResult,
  ObservationCurationClaimService,
} from './observation-curation-claim.service';
import { ObservationCurationPriorityService } from './observation-curation-priority.service';
import {
  type CurationDetailResult,
  type CurationQueueRowResult,
  type ObservationReadinessSummaryResult,
  ObservationCurationService,
} from './observation-curation.service';
import { WORKFLOW_ACTION_ROLES } from './observation-training-interpretation.service';
import { ObservationSourceLinkReviewService } from './observation-source-link-review.service';
import { ObservationTrainingInterpretationService } from './observation-training-interpretation.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

/**
 * Gate 13: the human-in-the-loop curation layer over Gate 11/12's
 * observation knowledge base. Every route below is CONTENT_AUTHOR/
 * REVIEWER/ADMIN-only - a learner or unauthenticated caller can never
 * reach this controller (Gate 13 §43).
 */
@Controller('admin/observation-curation')
export class ObservationCurationController {
  constructor(
    private readonly curation: ObservationCurationService,
    private readonly sourceLinkReviews: ObservationSourceLinkReviewService,
    private readonly trainingInterpretations: ObservationTrainingInterpretationService,
    private readonly priority: ObservationCurationPriorityService,
    private readonly claims: ObservationCurationClaimService,
  ) {}

  @Roles(READ_ROLES)
  @Get('baseline')
  getBaseline(): Promise<Record<string, number>> {
    return this.curation.getBaseline();
  }

  @Roles(READ_ROLES)
  @Get('queue')
  listQueue(
    @Query() query: ListObservationCurationQueueQueryDto,
  ): Promise<PaginatedResult<CurationQueueRowResult>> {
    return this.curation.listQueue(query);
  }

  @Roles(READ_ROLES)
  @Get(':versionId')
  getDetail(@Param('versionId') versionId: string): Promise<CurationDetailResult> {
    return this.curation.getCurationDetail(versionId);
  }

  @Roles(READ_ROLES)
  @Get(':versionId/readiness')
  getReadiness(@Param('versionId') versionId: string): Promise<ObservationReadinessSummaryResult> {
    return this.curation.getReadinessSummary(versionId);
  }

  @Roles(READ_ROLES)
  @Get(':versionId/history')
  getHistory(
    @Param('versionId') versionId: string,
    @Query() query: PaginationQueryDto,
  ): ReturnType<ObservationCurationService['getHistory']> {
    return this.curation.getHistory(versionId, query.page, query.pageSize);
  }

  @Roles(WRITE_ROLES)
  @Patch(':versionId/domain')
  curateDomain(
    @Param('versionId') versionId: string,
    @Body() dto: CurateDomainDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CurationDetailResult> {
    return this.curation.curateDomain(versionId, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':versionId/roles')
  curateRoles(
    @Param('versionId') versionId: string,
    @Body() dto: CurateProfessionalRolesDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CurationDetailResult> {
    return this.curation.curateProfessionalRoles(versionId, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':versionId/risk')
  curateRisk(
    @Param('versionId') versionId: string,
    @Body() dto: CurateRiskDimensionsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CurationDetailResult> {
    return this.curation.curateRiskDimensions(versionId, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':versionId/severity')
  curateSeverity(
    @Param('versionId') versionId: string,
    @Body() dto: CurateSeverityDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CurationDetailResult> {
    return this.curation.curateSeverity(versionId, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':versionId/root-cause')
  curateRootCause(
    @Param('versionId') versionId: string,
    @Body() dto: CurateRootCauseDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CurationDetailResult> {
    return this.curation.curateRootCause(versionId, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':versionId/readiness-decision')
  curateReadiness(
    @Param('versionId') versionId: string,
    @Body() dto: CurateReadinessDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CurationDetailResult> {
    return this.curation.curateReadiness(versionId, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':versionId/learning-objective')
  curateLearningObjective(
    @Param('versionId') versionId: string,
    @Body() dto: CurateLearningObjectiveDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CurationDetailResult> {
    return this.curation.curateLearningObjective(versionId, dto, user.id);
  }

  @Patch(':versionId/workflow')
  transitionWorkflow(
    @Param('versionId') versionId: string,
    @Body() dto: CurationWorkflowTransitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CurationDetailResult> {
    requireAnyRole(user, CURATION_WORKFLOW_ACTION_ROLES[dto.action]);
    return this.curation.transitionCurationWorkflow(versionId, dto.action, user.id);
  }

  // --- Source-link reviews (Gate 13 §17/§18) --------------------------------

  @Roles(WRITE_ROLES)
  @Post(':versionId/source-link-reviews')
  createSourceLinkReview(
    @Param('versionId') versionId: string,
    @Body() dto: CreateSourceLinkReviewDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ObservationSourceLinkReviewService['createReview']> {
    return this.sourceLinkReviews.createReview(versionId, dto, user.id);
  }

  @Roles(READ_ROLES)
  @Get(':versionId/source-link-reviews')
  listSourceLinkReviews(
    @Param('versionId') versionId: string,
  ): ReturnType<ObservationSourceLinkReviewService['listForVersion']> {
    return this.sourceLinkReviews.listForVersion(versionId);
  }

  @Roles(WRITE_ROLES)
  @Patch(':versionId/source-link-reviews/:reviewId')
  decideSourceLinkReview(
    @Param('versionId') versionId: string,
    @Param('reviewId') reviewId: string,
    @Body() dto: DecideSourceLinkReviewDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ObservationSourceLinkReviewService['decideReview']> {
    return this.sourceLinkReviews.decideReview(versionId, reviewId, dto, user.id);
  }

  // --- Training interpretations (Gate 13 §19/§20) ---------------------------

  @Roles(WRITE_ROLES)
  @Post(':versionId/training-interpretations')
  createTrainingInterpretation(
    @Param('versionId') versionId: string,
    @Body() dto: CreateTrainingInterpretationDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ObservationTrainingInterpretationService['create']> {
    return this.trainingInterpretations.create(versionId, dto, user.id);
  }

  @Roles(READ_ROLES)
  @Get(':versionId/training-interpretations')
  listTrainingInterpretations(
    @Param('versionId') versionId: string,
  ): ReturnType<ObservationTrainingInterpretationService['listForVersion']> {
    return this.trainingInterpretations.listForVersion(versionId);
  }

  @Roles(WRITE_ROLES)
  @Patch(':versionId/training-interpretations/:interpretationId')
  updateTrainingInterpretation(
    @Param('versionId') versionId: string,
    @Param('interpretationId') interpretationId: string,
    @Body() dto: UpdateTrainingInterpretationDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ObservationTrainingInterpretationService['update']> {
    return this.trainingInterpretations.update(versionId, interpretationId, dto, user.id);
  }

  @Patch(':versionId/training-interpretations/:interpretationId/status')
  transitionTrainingInterpretation(
    @Param('versionId') versionId: string,
    @Param('interpretationId') interpretationId: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ObservationTrainingInterpretationService['transition']> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.trainingInterpretations.transition(
      versionId,
      interpretationId,
      dto.action,
      user.id,
    );
  }

  // --- Bulk curation (Gate 13 §33/§34) ---------------------------------------

  @Roles(WRITE_ROLES)
  @Post('bulk/preview')
  bulkPreview(@Body() dto: BulkCurationDto): ReturnType<ObservationCurationService['bulkPreview']> {
    return this.curation.bulkPreview(dto);
  }

  @Roles(WRITE_ROLES)
  @Post('bulk/commit')
  bulkCommit(
    @Body() dto: BulkCurationDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ObservationCurationService['bulkCommit']> {
    return this.curation.bulkCommit(dto, user.id);
  }

  // --- Deterministic priority + bounded claim/lease (Gate 14 §23-26) --------

  @Roles([UserRole.ADMIN])
  @Post('priority/assign')
  assignPriorities(): ReturnType<ObservationCurationPriorityService['assignPriorities']> {
    return this.priority.assignPriorities();
  }

  @Roles(WRITE_ROLES)
  @Post('claim')
  claim(
    @Body() dto: ClaimCurationBatchDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CurationClaimResult> {
    return this.claims.claim(user.id, dto.maxCount ?? 50);
  }

  @Roles(WRITE_ROLES)
  @Post('claim/release')
  async releaseClaim(
    @Body() dto: ReleaseCurationClaimDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ released: number }> {
    const released = await this.claims.release(
      dto.observationVersionIds,
      user.id,
      user.roles.includes(UserRole.ADMIN),
    );
    return { released };
  }
}
