import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { CaseStudyQuestionGenerationService } from './case-study-question-generation.service';
import { CaseStudyVersionsService } from './case-study-versions.service';
import { CreateCaseStudyVersionDto } from './dto/create-case-study-version.dto';
import { GenerateCaseStudyQuestionDto } from './dto/generate-case-study-question.dto';
import { ReviewCaseStudyVersionDto } from './dto/review-case-study-version.dto';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];
const REVIEW_ROLES = [UserRole.REVIEWER, UserRole.ADMIN];
const PUBLISH_ROLES = [UserRole.ADMIN];
// Gate 17 §21: generation requires an author/admin role - never a learner,
// never a bare reviewer (reviewers approve candidates, they do not create
// them, matching the existing case-study/question generation convention).
const GENERATE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

/**
 * Gate 15 §6/§22/§23: the versioned case-study narrative history and its
 * mandatory human review workflow - additive routes alongside (never
 * replacing) the pre-existing `/admin/case-studies` flat CRUD controller.
 */
@Controller('admin/case-studies/:caseStudyId/versions')
export class CaseStudyVersionsController {
  constructor(
    private readonly versions: CaseStudyVersionsService,
    private readonly questionGeneration: CaseStudyQuestionGenerationService,
  ) {}

  @Roles(READ_ROLES)
  @Get()
  list(
    @Param('caseStudyId') caseStudyId: string,
  ): ReturnType<CaseStudyVersionsService['listForCaseStudy']> {
    return this.versions.listForCaseStudy(caseStudyId);
  }

  @Roles(READ_ROLES)
  @Get(':versionId')
  get(
    @Param('caseStudyId') caseStudyId: string,
    @Param('versionId') versionId: string,
  ): ReturnType<CaseStudyVersionsService['get']> {
    return this.versions.get(caseStudyId, versionId);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(
    @Param('caseStudyId') caseStudyId: string,
    @Body() dto: CreateCaseStudyVersionDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudyVersionsService['createHumanAuthored']> {
    return this.versions.createHumanAuthored(caseStudyId, dto, user.id);
  }

  @Roles(REVIEW_ROLES)
  @Patch(':versionId/review-start')
  startReview(
    @Param('caseStudyId') caseStudyId: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudyVersionsService['startReview']> {
    return this.versions.startReview(caseStudyId, versionId, user.id);
  }

  @Roles(REVIEW_ROLES)
  @Patch(':versionId/review')
  review(
    @Param('caseStudyId') caseStudyId: string,
    @Param('versionId') versionId: string,
    @Body() dto: ReviewCaseStudyVersionDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudyVersionsService['review']> {
    return this.versions.review(caseStudyId, versionId, dto, user.id);
  }

  @Roles(PUBLISH_ROLES)
  @Patch(':versionId/publish')
  publish(
    @Param('caseStudyId') caseStudyId: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudyVersionsService['publish']> {
    return this.versions.publish(caseStudyId, versionId, user.id);
  }

  /**
   * Gate 17: generates ONE question candidate grounded on this (already
   * APPROVED/PUBLISHED) case-study version. `caseStudyId` in the path is
   * not otherwise used - the version is resolved and re-validated by its
   * own id, exactly like every other generation endpoint in this codebase,
   * so the path is only for REST consistency with the sibling routes above.
   */
  @Roles(GENERATE_ROLES)
  @Post(':versionId/generate-question')
  generateQuestion(
    @Param('versionId') versionId: string,
    @Body() dto: GenerateCaseStudyQuestionDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudyQuestionGenerationService['generate']> {
    return this.questionGeneration.generate(versionId, dto, user.id);
  }
}
