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
import { type LearningObjective } from '@prisma/client';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { ReorderDto } from '../common/reorder.dto';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { WORKFLOW_ACTION_ROLES } from '../common/workflow';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { ListObjectivesQueryDto } from './dto/list-objectives.query.dto';
import { UpdateObjectiveDto } from './dto/update-objective.dto';
import { ObjectivesService } from './objectives.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

@Controller('admin/learning-objectives')
export class ObjectivesController {
  constructor(private readonly objectives: ObjectivesService) {}

  @Roles(READ_ROLES)
  @Get()
  list(@Query() query: ListObjectivesQueryDto): Promise<PaginatedResult<LearningObjective>> {
    return this.objectives.list(query);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): Promise<LearningObjective> {
    return this.objectives.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(
    @Body() dto: CreateObjectiveDto,
    @CurrentUser() user: RequestUser,
  ): Promise<LearningObjective> {
    return this.objectives.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Post('reorder')
  reorder(@Body() dto: ReorderDto, @CurrentUser() user: RequestUser): Promise<void> {
    return this.objectives.reorder(dto.parentId, dto.orderedIds, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateObjectiveDto,
    @CurrentUser() user: RequestUser,
  ): Promise<LearningObjective> {
    return this.objectives.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.objectives.remove(id, user.id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<LearningObjective> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.objectives.transition(id, dto.action, user.id);
  }
}
