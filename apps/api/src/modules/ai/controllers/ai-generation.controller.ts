import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { AiGenerationService } from '../ai-generation.service';
import { GenerateConceptsDto } from '../dto/generate-concepts.dto';
import { GenerateLearningObjectivesDto } from '../dto/generate-learning-objectives.dto';
import { GenerateQuestionsDto } from '../dto/generate-questions.dto';
import { ListRunsQueryDto } from '../dto/list-runs.query.dto';

const GENERATE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];
const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];

@Controller('admin/ai')
export class AiGenerationController {
  constructor(private readonly generation: AiGenerationService) {}

  @Roles(GENERATE_ROLES)
  @Post('generate/concepts')
  generateConcepts(
    @Body() dto: GenerateConceptsDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<AiGenerationService['generateConcepts']> {
    return this.generation.generateConcepts(dto, user.id);
  }

  @Roles(GENERATE_ROLES)
  @Post('generate/learning-objectives')
  generateLearningObjectives(
    @Body() dto: GenerateLearningObjectivesDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<AiGenerationService['generateLearningObjectives']> {
    return this.generation.generateLearningObjectives(dto, user.id);
  }

  @Roles(GENERATE_ROLES)
  @Post('generate/questions')
  generateQuestions(
    @Body() dto: GenerateQuestionsDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<AiGenerationService['generateQuestions']> {
    return this.generation.generateQuestions(dto, user.id);
  }

  @Roles(READ_ROLES)
  @Get('runs')
  listRuns(@Query() query: ListRunsQueryDto): ReturnType<AiGenerationService['listRuns']> {
    return this.generation.listRuns(query);
  }

  @Roles(READ_ROLES)
  @Get('runs/:id')
  getRun(@Param('id') id: string): ReturnType<AiGenerationService['getRun']> {
    return this.generation.getRun(id);
  }
}
