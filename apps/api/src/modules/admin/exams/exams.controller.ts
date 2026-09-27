import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { AuditAction, UserRole } from '@gcp/shared';

import { AuditService } from '../../../common/audit/audit.service';
import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { CreateExamDto } from './dto/create-exam.dto';
import { ExamVersionTransitionDto } from './dto/exam-version-transition.dto';
import { ListExamsQueryDto } from './dto/list-exams.query.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { UpsertBlueprintDto } from './dto/upsert-blueprint.dto';
import { ExamBlueprintCoverageService } from './exam-blueprint-coverage.service';
import { ExamBlueprintValidationService } from './exam-blueprint-validation.service';
import { ExamBlueprintService } from './exam-blueprint.service';
import { ExamsService } from './exams.service';

/**
 * Stage 7A grants examination configuration exclusively to ADMIN. The spec
 * explicitly withholds activation authority from CONTENT_AUTHOR and REVIEWER
 * and does not grant either role any other exam-configuration capability -
 * unlike the Stage 6 question bank, there is no author/reviewer split here.
 */
const ADMIN_ONLY = [UserRole.ADMIN];

@Controller('admin/exams')
@Roles(ADMIN_ONLY)
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly blueprints: ExamBlueprintService,
    private readonly validation: ExamBlueprintValidationService,
    private readonly coverage: ExamBlueprintCoverageService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() query: ListExamsQueryDto): ReturnType<ExamsService['list']> {
    return this.exams.list(query);
  }

  @Post()
  create(
    @Body() dto: CreateExamDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ExamsService['create']> {
    return this.exams.create(dto, user.id);
  }

  @Get(':id')
  get(@Param('id') id: string): ReturnType<ExamsService['get']> {
    return this.exams.get(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExamDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ExamsService['update']> {
    return this.exams.update(id, dto, user.id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: ExamVersionTransitionDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ExamsService['transition']> {
    return this.exams.transition(id, dto.action, user.id);
  }

  @Get(':id/blueprint')
  getBlueprint(@Param('id') id: string): ReturnType<ExamBlueprintService['get']> {
    return this.blueprints.get(id);
  }

  @Post(':id/blueprint')
  createBlueprint(
    @Param('id') id: string,
    @Body() dto: UpsertBlueprintDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ExamBlueprintService['create']> {
    return this.blueprints.create(id, dto, user.id);
  }

  @Patch(':id/blueprint')
  replaceBlueprint(
    @Param('id') id: string,
    @Body() dto: UpsertBlueprintDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ExamBlueprintService['replace']> {
    return this.blueprints.replace(id, dto, user.id);
  }

  @Get(':id/blueprint/validate')
  async validateBlueprint(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<ExamBlueprintValidationService['validateForExam']> {
    const result = await this.validation.validateForExam(id);
    await this.audit.record({
      action: AuditAction.EXAM_BLUEPRINT_VALIDATED,
      entity: 'exam',
      entityId: id,
      actorId: user.id,
      metadata: { valid: result.valid, errorCount: result.errors.length },
    });
    return result;
  }

  @Get(':id/blueprint/coverage')
  coverageAnalysis(
    @Param('id') id: string,
  ): ReturnType<ExamBlueprintCoverageService['analyzeForExam']> {
    return this.coverage.analyzeForExam(id);
  }
}
