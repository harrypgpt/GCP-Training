import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { CaseStudyEligibilityService } from './case-study-eligibility.service';
import { CaseStudyGenerationService } from './case-study-generation.service';
import { CaseStudySpecificationsService } from './case-study-specifications.service';
import { CreateCaseStudySpecificationDto } from './dto/create-specification.dto';
import { GenerateCaseStudyDto } from './dto/generate-case-study.dto';
import { ListCaseStudySpecificationsQueryDto } from './dto/list-specifications.query.dto';
import { UpdateCaseStudySpecificationDto } from './dto/update-specification.dto';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

/**
 * Gate 15 §20/§28: admin-only case-study specification authoring and
 * generation triggering. Never reachable by a learner or unauthenticated
 * caller (global JwtAuthGuard + per-route @Roles).
 */
@Controller('admin/case-study-specifications')
export class CaseStudySpecificationsController {
  constructor(
    private readonly specifications: CaseStudySpecificationsService,
    private readonly generation: CaseStudyGenerationService,
    private readonly eligibility: CaseStudyEligibilityService,
  ) {}

  @Roles(READ_ROLES)
  @Get()
  list(
    @Query() query: ListCaseStudySpecificationsQueryDto,
  ): ReturnType<CaseStudySpecificationsService['list']> {
    return this.specifications.list(query);
  }

  @Roles(READ_ROLES)
  @Get('eligibility/:observationVersionId')
  assessEligibility(
    @Param('observationVersionId') observationVersionId: string,
  ): ReturnType<CaseStudyEligibilityService['assess']> {
    return this.eligibility.assess(observationVersionId);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): ReturnType<CaseStudySpecificationsService['get']> {
    return this.specifications.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(
    @Body() dto: CreateCaseStudySpecificationDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudySpecificationsService['create']> {
    return this.specifications.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCaseStudySpecificationDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudySpecificationsService['update']> {
    return this.specifications.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Post(':id/validate')
  validate(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudySpecificationsService['validate']> {
    return this.specifications.validate(id, user.id);
  }

  @Roles(WRITE_ROLES)
  @Post(':id/generate')
  generate(
    @Param('id') id: string,
    @Body() dto: GenerateCaseStudyDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudyGenerationService['generate']> {
    return this.generation.generate(id, dto, user.id);
  }
}

@Controller('admin/case-study-generations')
export class CaseStudyGenerationsController {
  constructor(private readonly generation: CaseStudyGenerationService) {}

  @Roles(READ_ROLES)
  @Get(':runId')
  getRun(
    @Param('runId') runId: string,
  ): ReturnType<CaseStudyGenerationService['getGenerationRun']> {
    return this.generation.getGenerationRun(runId);
  }
}
