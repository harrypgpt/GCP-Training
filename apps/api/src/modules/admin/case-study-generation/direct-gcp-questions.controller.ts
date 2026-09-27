import { Body, Controller, Post } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { CaseStudyQuestionGenerationService } from './case-study-question-generation.service';
import { GenerateDirectGcpQuestionDto } from './dto/generate-direct-gcp-question.dto';

const GENERATE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

/**
 * Gate 18 §4 TYPE 1: DIRECT_GCP question generation, grounded solely in ICH
 * E6(R3) - no observation or case-study resource in the path, since none is
 * required or accepted. Kept as its own small controller rather than
 * overloading `CaseStudyVersionsController` (which is inherently scoped to
 * a `:caseStudyId/versions/:versionId`, neither of which exists here).
 */
@Controller('admin/direct-gcp-questions')
export class DirectGcpQuestionsController {
  constructor(private readonly generation: CaseStudyQuestionGenerationService) {}

  @Roles(GENERATE_ROLES)
  @Post('generate')
  generate(
    @Body() dto: GenerateDirectGcpQuestionDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudyQuestionGenerationService['generateDirectGcp']> {
    return this.generation.generateDirectGcp(dto, user.id);
  }
}
