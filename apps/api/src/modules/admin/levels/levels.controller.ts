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
import { type TrainingLevel } from '@prisma/client';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { ReorderDto } from '../common/reorder.dto';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { WORKFLOW_ACTION_ROLES } from '../common/workflow';
import { CreateLevelDto } from './dto/create-level.dto';
import { ListLevelsQueryDto } from './dto/list-levels.query.dto';
import { UpdateLevelDto } from './dto/update-level.dto';
import { LevelsService } from './levels.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

@Controller('admin/levels')
export class LevelsController {
  constructor(private readonly levels: LevelsService) {}

  @Roles(READ_ROLES)
  @Get()
  list(@Query() query: ListLevelsQueryDto): Promise<PaginatedResult<TrainingLevel>> {
    return this.levels.list(query);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): Promise<TrainingLevel> {
    return this.levels.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(@Body() dto: CreateLevelDto, @CurrentUser() user: RequestUser): Promise<TrainingLevel> {
    return this.levels.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Post('reorder')
  reorder(@Body() dto: ReorderDto, @CurrentUser() user: RequestUser): Promise<void> {
    return this.levels.reorder(dto.parentId, dto.orderedIds, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLevelDto,
    @CurrentUser() user: RequestUser,
  ): Promise<TrainingLevel> {
    return this.levels.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.levels.remove(id, user.id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<TrainingLevel> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.levels.transition(id, dto.action, user.id);
  }
}
