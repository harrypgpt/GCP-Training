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
import { type Source } from '@prisma/client';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { requireAnyRole } from '../common/require-roles';
import { TransitionDto } from '../common/transition.dto';
import { WORKFLOW_ACTION_ROLES } from '../common/workflow';
import { CreateSourceDto } from './dto/create-source.dto';
import { ListSourcesQueryDto } from './dto/list-sources.query.dto';
import { UpdateSourceDto } from './dto/update-source.dto';
import { SourcesService } from './sources.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

@Controller('admin/sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Roles(READ_ROLES)
  @Get()
  list(@Query() query: ListSourcesQueryDto): Promise<PaginatedResult<Source>> {
    return this.sources.list(query);
  }

  @Roles(READ_ROLES)
  @Get(':id')
  get(@Param('id') id: string): Promise<Source> {
    return this.sources.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post()
  create(@Body() dto: CreateSourceDto, @CurrentUser() user: RequestUser): Promise<Source> {
    return this.sources.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSourceDto,
    @CurrentUser() user: RequestUser,
  ): Promise<Source> {
    return this.sources.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.sources.remove(id, user.id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<Source> {
    requireAnyRole(user, WORKFLOW_ACTION_ROLES[dto.action]);
    return this.sources.transition(id, dto.action, user.id);
  }
}
