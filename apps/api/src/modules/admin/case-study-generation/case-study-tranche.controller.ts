import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { CaseStudyTrancheService } from './case-study-tranche.service';
import { SelectTrancheDto } from './dto/select-tranche.dto';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

/**
 * Gate 16 §3/§6/§30: the deterministic real-data tranche - admin-only,
 * never reachable by a learner.
 */
@Controller('admin/case-study-tranches')
export class CaseStudyTrancheController {
  constructor(private readonly tranches: CaseStudyTrancheService) {}

  @Roles(READ_ROLES)
  @Get()
  list(): ReturnType<CaseStudyTrancheService['list']> {
    return this.tranches.list();
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): ReturnType<CaseStudyTrancheService['get']> {
    return this.tranches.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  select(
    @Body() dto: SelectTrancheDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudyTrancheService['selectTranche']> {
    return this.tranches.selectTranche(dto, user.id);
  }
}
