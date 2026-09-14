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
import { SetActiveDto } from '../common/set-active.dto';
import { CaseStudiesService } from './case-studies.service';
import { CreateCaseStudyDto } from './dto/create-case-study.dto';
import { ListCaseStudiesQueryDto } from './dto/list-case-studies.query.dto';
import { UpdateCaseStudyDto } from './dto/update-case-study.dto';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

@Controller('admin/case-studies')
export class CaseStudiesController {
  constructor(private readonly caseStudies: CaseStudiesService) {}

  @Roles(READ_ROLES)
  @Get()
  list(@Query() query: ListCaseStudiesQueryDto): ReturnType<CaseStudiesService['list']> {
    return this.caseStudies.list(query);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): ReturnType<CaseStudiesService['get']> {
    return this.caseStudies.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(
    @Body() dto: CreateCaseStudyDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudiesService['create']> {
    return this.caseStudies.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCaseStudyDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudiesService['update']> {
    return this.caseStudies.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id/active')
  setActive(
    @Param('id') id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudiesService['setActive']> {
    return this.caseStudies.setActive(id, dto.isActive, user.id);
  }

  @Roles(WRITE_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.caseStudies.remove(id, user.id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<CaseStudiesService['transition']> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.caseStudies.transition(id, dto.action, user.id);
  }
}
