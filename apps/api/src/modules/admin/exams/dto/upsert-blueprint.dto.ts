import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { BlueprintRuleDto } from './blueprint-rule.dto';

export class UpsertBlueprintDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Full desired rule set - POST/PATCH both replace all rules
   * transactionally rather than diffing a partial update (Stage 7A: kept
   * deterministic and simple rather than inventing partial-patch semantics). */
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BlueprintRuleDto)
  rules!: BlueprintRuleDto[];
}
