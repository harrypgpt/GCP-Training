import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { AiCandidateConversionService } from '../ai-candidate-conversion.service';
import { AiCandidatesService } from '../ai-candidates.service';
import { ListCandidatesQueryDto } from '../dto/list-candidates.query.dto';
import { RejectCandidateDto } from '../dto/reject-candidate.dto';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const REVIEW_ROLES = [UserRole.REVIEWER, UserRole.ADMIN];

@Controller('admin/ai/question-candidates')
export class AiCandidatesController {
  constructor(
    private readonly candidates: AiCandidatesService,
    private readonly conversion: AiCandidateConversionService,
  ) {}

  @Roles(READ_ROLES)
  @Get()
  list(@Query() query: ListCandidatesQueryDto): ReturnType<AiCandidatesService['list']> {
    return this.candidates.list(query);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): ReturnType<AiCandidatesService['get']> {
    return this.candidates.get(id);
  }

  @Roles(REVIEW_ROLES)
  @Post(':id/accept')
  accept(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<AiCandidatesService['accept']> {
    return this.candidates.accept(id, user.id);
  }

  @Roles(REVIEW_ROLES)
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectCandidateDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<AiCandidatesService['reject']> {
    return this.candidates.reject(id, dto.reason, user.id);
  }

  @Roles(REVIEW_ROLES)
  @Post(':id/convert-to-question')
  convert(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<AiCandidateConversionService['convert']> {
    return this.conversion.convert(id, user.id);
  }
}
