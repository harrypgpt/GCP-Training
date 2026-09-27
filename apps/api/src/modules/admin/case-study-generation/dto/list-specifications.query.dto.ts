import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { CaseStudyScenarioType, CaseStudySpecificationStatus } from '@gcp/shared';

import { PaginationQueryDto } from '../../common/pagination.dto';

export class ListCaseStudySpecificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CaseStudySpecificationStatus)
  status?: CaseStudySpecificationStatus;

  @IsOptional()
  @IsEnum(CaseStudyScenarioType)
  scenarioType?: CaseStudyScenarioType;

  @IsOptional()
  @IsUUID()
  domainId?: string;
}
