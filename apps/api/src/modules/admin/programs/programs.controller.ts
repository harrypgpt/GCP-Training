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
import { type TrainingProgram } from '@prisma/client';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { WORKFLOW_ACTION_ROLES } from '../common/workflow';
import { CreateProgramDto } from './dto/create-program.dto';
import { ListProgramsQueryDto } from './dto/list-programs.query.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { ProgramsService } from './programs.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

@Controller('admin/programs')
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  @Roles(READ_ROLES)
  @Get()
  list(@Query() query: ListProgramsQueryDto): Promise<PaginatedResult<TrainingProgram>> {
    return this.programs.list(query);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): Promise<TrainingProgram> {
    return this.programs.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(
    @Body() dto: CreateProgramDto,
    @CurrentUser() user: RequestUser,
  ): Promise<TrainingProgram> {
    return this.programs.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProgramDto,
    @CurrentUser() user: RequestUser,
  ): Promise<TrainingProgram> {
    return this.programs.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.programs.remove(id, user.id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<TrainingProgram> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.programs.transition(id, dto.action, user.id);
  }
}
