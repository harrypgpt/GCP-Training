import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { AiCandidateConversionService } from '../ai-candidate-conversion.service';
import { AiCandidateQualityReviewService } from '../ai-candidate-quality-review.service';
import { AiCandidatesService } from '../ai-candidates.service';
import { ListCandidatesQueryDto } from '../dto/list-candidates.query.dto';
import { RejectCandidateDto } from '../dto/reject-candidate.dto';
import { SubmitQualityReviewDto } from '../dto/submit-quality-review.dto';
import { QuestionPromotionService } from '../question-promotion.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const REVIEW_ROLES = [UserRole.REVIEWER, UserRole.ADMIN];

@Controller('admin/ai/question-candidates')
export class AiCandidatesController {
  constructor(
    private readonly candidates: AiCandidatesService,
    private readonly conversion: AiCandidateConversionService,
    private readonly qualityReview: AiCandidateQualityReviewService,
    private readonly promotion: QuestionPromotionService,
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

  @Roles(REVIEW_ROLES)
  @Post(':id/quality-review')
  submitQualityReview(
    @Param('id') id: string,
    @Body() dto: SubmitQualityReviewDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<AiCandidateQualityReviewService['submit']> {
    return this.qualityReview.submit(id, dto, user.id);
  }

  /**
   * Gate 22 §6-§9: the controlled, re-verifying promotion path. Distinct
   * from `/convert-to-question` (Gate 15-18, unmodified, still available)
   * which only checks ACCEPTED + not-already-converted - this additionally
   * requires a recorded Gate 21 quality review, re-checks the
   * mandatory-dimension gate and duplicate status fresh at promotion time,
   * and verifies the candidate's persisted deterministic validation/
   * governance result and normative/scenario provenance before ever
   * delegating to the same underlying conversion write.
   */
  @Roles(REVIEW_ROLES)
  @Post(':id/promote')
  promote(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<QuestionPromotionService['promote']> {
    return this.promotion.promote(id, user.id);
  }
}
