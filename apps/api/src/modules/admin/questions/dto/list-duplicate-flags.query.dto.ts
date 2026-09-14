import { IsBoolean, IsOptional } from 'class-validator';

import { ToBoolean } from '../../common/to-boolean.transform';

export class ListDuplicateFlagsQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeResolved?: boolean;
}
