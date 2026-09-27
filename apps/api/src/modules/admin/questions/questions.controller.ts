import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { WORKFLOW_ACTION_ROLES } from '../common/workflow';
import { CreateQuestionDto } from './dto/create-question.dto';
import { ListDuplicateFlagsQueryDto } from './dto/list-duplicate-flags.query.dto';
import { ListQuestionsQueryDto } from './dto/list-questions.query.dto';
import { ResolveDuplicateDto } from './dto/resolve-duplicate.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionBankSufficiencyService } from './question-bank-sufficiency.service';
import { QuestionsService } from './questions.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];
const REVIEW_ROLES = [UserRole.REVIEWER, UserRole.ADMIN];

@Controller('admin/questions')
export class QuestionsController {
  constructor(
    private readonly questions: QuestionsService,
    private readonly sufficiency: QuestionBankSufficiencyService,
  ) {}

  @Roles(READ_ROLES)
  @Get()
  list(@Query() query: ListQuestionsQueryDto): ReturnType<QuestionsService['list']> {
    return this.questions.list(query);
  }

  /** Gate 22 §25/§34, extended by Gate 24: admin-only inventory + blueprint
   * coverage + ICH E6(R3) sufficiency analysis - must be registered before
   * `:id` so "readiness" is never parsed as a question id. */
  @Roles([UserRole.ADMIN])
  @Get('readiness')
  readinessSummary(): ReturnType<QuestionBankSufficiencyService['getSummary']> {
    return this.sufficiency.getSummary();
  }

  @Roles(READ_ROLES)
  @Get('duplicate-flags')
  listDuplicateFlags(
    @Query() query: ListDuplicateFlagsQueryDto,
  ): ReturnType<QuestionsService['listDuplicateFlags']> {
    return this.questions.listDuplicateFlags(query.includeResolved ?? false);
  }

  @Roles(REVIEW_ROLES)
  @Patch('duplicate-flags/:flagId/resolve')
  resolveDuplicateFlag(
    @Param('flagId') flagId: string,
    @Body() dto: ResolveDuplicateDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<QuestionsService['resolveDuplicateFlag']> {
    return this.questions.resolveDuplicateFlag(flagId, dto.resolutionNote, user.id);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): ReturnType<QuestionsService['get']> {
    return this.questions.get(id);
  }

  @Roles(READ_ROLES)
  @Get(':id/versions/:versionId')
  getVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ): ReturnType<QuestionsService['getVersion']> {
    return this.questions.getVersion(id, versionId);
  }

  @Roles(READ_ROLES)
  @Get(':id/preview')
  preview(@Param('id') id: string): ReturnType<QuestionsService['preview']> {
    return this.questions.preview(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(
    @Body() dto: CreateQuestionDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<QuestionsService['create']> {
    return this.questions.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<QuestionsService['update']> {
    return this.questions.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.questions.remove(id, user.id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<QuestionsService['transition']> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.questions.transition(id, dto.action, user.id);
  }
}
