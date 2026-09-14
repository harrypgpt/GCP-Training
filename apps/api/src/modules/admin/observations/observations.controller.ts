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
import { type Observation } from '@prisma/client';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { WORKFLOW_ACTION_ROLES } from '../common/workflow';
import { SetActiveDto } from '../common/set-active.dto';
import { CreateObservationDto } from './dto/create-observation.dto';
import { ListObservationsQueryDto } from './dto/list-observations.query.dto';
import { UpdateObservationDto } from './dto/update-observation.dto';
import { ObservationsService } from './observations.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

@Controller('admin/observations')
export class ObservationsController {
  constructor(private readonly observations: ObservationsService) {}

  @Roles(READ_ROLES)
  @Get()
  list(@Query() query: ListObservationsQueryDto): Promise<PaginatedResult<Observation>> {
    return this.observations.list(query);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): Promise<Observation> {
    return this.observations.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(
    @Body() dto: CreateObservationDto,
    @CurrentUser() user: RequestUser,
  ): Promise<Observation> {
    return this.observations.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateObservationDto,
    @CurrentUser() user: RequestUser,
  ): Promise<Observation> {
    return this.observations.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id/active')
  setActive(
    @Param('id') id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() user: RequestUser,
  ): Promise<Observation> {
    return this.observations.setActive(id, dto.isActive, user.id);
  }

  @Roles(WRITE_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.observations.remove(id, user.id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<Observation> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.observations.transition(id, dto.action, user.id);
  }
}
