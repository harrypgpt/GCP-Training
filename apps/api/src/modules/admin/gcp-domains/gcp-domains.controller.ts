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
import { type GcpDomain } from '@prisma/client';

import { Roles } from '../../../common/rbac/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type PaginatedResult } from '../common/pagination';
import { CreateDomainRoleMapDto } from './dto/create-domain-role-map.dto';
import { CreateDomainDto } from './dto/create-domain.dto';
import { ListDomainsQueryDto } from './dto/list-domains.query.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { type DomainRoleMapEntryResult, GcpDomainsService } from './gcp-domains.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];
const WRITE_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.ADMIN];

/**
 * Gate 14 §36: taxonomy governance - only content authors/admins may
 * create/modify/retire a GCP domain or the role-to-domain reference matrix.
 * Distinct route prefix (`admin/taxonomy/*`) from the pre-existing
 * read-only `GET admin/gcp-domains` lookup (LookupsController) it does not
 * replace.
 */
@Controller('admin/taxonomy')
export class GcpDomainsController {
  constructor(private readonly domains: GcpDomainsService) {}

  @Roles(READ_ROLES)
  @Get('domains')
  list(@Query() query: ListDomainsQueryDto): Promise<PaginatedResult<GcpDomain>> {
    return this.domains.list(query);
  }

  @Roles(READ_ROLES)
  @Get('domains/:id')
  get(@Param('id') id: string): Promise<GcpDomain> {
    return this.domains.get(id);
  }

  @Roles(WRITE_ROLES)
  @Post('domains')
  create(@Body() dto: CreateDomainDto, @CurrentUser() user: RequestUser): Promise<GcpDomain> {
    return this.domains.create(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Patch('domains/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDomainDto,
    @CurrentUser() user: RequestUser,
  ): Promise<GcpDomain> {
    return this.domains.update(id, dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Post('domains/:id/retire')
  retire(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<GcpDomain> {
    return this.domains.retire(id, user.id);
  }

  @Roles(WRITE_ROLES)
  @Post('domains/:id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<GcpDomain> {
    return this.domains.restore(id, user.id);
  }

  @Roles(READ_ROLES)
  @Get('role-map')
  listRoleMap(@Query('domainId') domainId?: string): Promise<DomainRoleMapEntryResult[]> {
    return this.domains.listRoleMap(domainId);
  }

  @Roles(WRITE_ROLES)
  @Post('role-map')
  createRoleMapEntry(
    @Body() dto: CreateDomainRoleMapDto,
    @CurrentUser() user: RequestUser,
  ): Promise<DomainRoleMapEntryResult> {
    return this.domains.createRoleMapEntry(dto, user.id);
  }

  @Roles(WRITE_ROLES)
  @Delete('role-map/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRoleMapEntry(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.domains.removeRoleMapEntry(id, user.id);
  }
}
