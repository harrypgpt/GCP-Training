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
import { type Module as CourseModule } from '@prisma/client';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { ReorderDto } from '../common/reorder.dto';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { WORKFLOW_ACTION_ROLES } from '../common/workflow';
import { CourseModulesService } from './course-modules.service';
import { CreateCourseModuleDto } from './dto/create-course-module.dto';
import { ListCourseModulesQueryDto } from './dto/list-course-modules.query.dto';
import { UpdateCourseModuleDto } from './dto/update-course-module.dto';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

@Controller('admin/modules')
export class CourseModulesController {
  constructor(private readonly modules: CourseModulesService) {}

  @Roles(READ_ROLES)
  @Get()
  list(@Query() query: ListCourseModulesQueryDto): Promise<PaginatedResult<CourseModule>> {
    return this.modules.list(query);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): Promise<CourseModule> {
    return this.modules.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(
    @Body() dto: CreateCourseModuleDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CourseModule> {
    return this.modules.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Post('reorder')
  reorder(@Body() dto: ReorderDto, @CurrentUser() user: RequestUser): Promise<void> {
    return this.modules.reorder(dto.parentId, dto.orderedIds, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCourseModuleDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CourseModule> {
    return this.modules.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.modules.remove(id, user.id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CourseModule> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.modules.transition(id, dto.action, user.id);
  }
}
