import { Module } from '@nestjs/common';

import { GcpDomainsController } from './gcp-domains.controller';
import { GcpDomainsService } from './gcp-domains.service';

@Module({
  controllers: [GcpDomainsController],
  providers: [GcpDomainsService],
  exports: [GcpDomainsService],
})
export class GcpDomainsModule {}
