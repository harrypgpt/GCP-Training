import { Controller, Get, Query } from '@nestjs/common';

import { UserRole } from '@gcp/shared';

import { Roles } from '../../../common/rbac/roles.decorator';
import { ListLookupQueryDto } from './dto/list-lookup.query.dto';
import { LookupsService } from './lookups.service';

const READ_ROLES = [UserRole.CONTENT_AUTHOR, UserRole.REVIEWER, UserRole.ADMIN];

@Roles(READ_ROLES)
@Controller('admin')
export class LookupsController {
  constructor(private readonly lookups: LookupsService) {}

  @Get('gcp-domains')
  listGcpDomains(@Query() query: ListLookupQueryDto): ReturnType<LookupsService['listGcpDomains']> {
    return this.lookups.listGcpDomains(query);
  }

  @Get('professional-roles')
  listProfessionalRoles(
    @Query() query: ListLookupQueryDto,
  ): ReturnType<LookupsService['listProfessionalRoles']> {
    return this.lookups.listProfessionalRoles(query);
  }
}
