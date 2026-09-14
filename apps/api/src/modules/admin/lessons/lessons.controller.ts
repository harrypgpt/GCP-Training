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
import { type Lesson } from '@prisma/client';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { ReorderDto } from '../common/reorder.dto';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { WORKFLOW_ACTION_ROLES } from '../common/workflow';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { ListLessonsQueryDto } from './dto/list-lessons.query.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { LessonsService } from './lessons.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

@Controller('admin/lessons')
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Roles(READ_ROLES)
  @Get()
  list(@Query() query: ListLessonsQueryDto): Promise<PaginatedResult<Lesson>> {
    return this.lessons.list(query);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): Promise<Lesson> {
    return this.lessons.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(@Body() dto: CreateLessonDto, @CurrentUser() user: RequestUser): Promise<Lesson> {
    return this.lessons.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Post('reorder')
  reorder(@Body() dto: ReorderDto, @CurrentUser() user: RequestUser): Promise<void> {
    return this.lessons.reorder(dto.parentId, dto.orderedIds, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLessonDto,
    @CurrentUser() user: RequestUser,
  ): Promise<Lesson> {
    return this.lessons.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.lessons.remove(id, user.id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<Lesson> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.lessons.transition(id, dto.action, user.id);
  }
}
