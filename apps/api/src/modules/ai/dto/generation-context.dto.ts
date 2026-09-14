import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** The grounding-context selection shared by every generation request. */
export class GenerationContextDto {
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceSection?: string;

  @IsOptional()
  @IsUUID()
  caseStudyId?: string;

  @IsOptional()
  @IsUUID()
  observationId?: string;

  @IsOptional()
  @IsUUID()
  learningObjectiveId?: string;

  @IsOptional()
  @IsUUID()
  levelId?: string;

  @IsOptional()
  @IsUUID()
  moduleId?: string;

  @IsOptional()
  @IsUUID()
  professionalRoleId?: string;

  @IsOptional()
  @IsUUID()
  domainId?: string;

  /**
   * Development/test-only failure injection, honoured ONLY by the mock
   * provider (a real provider ignores this field entirely). Never
   * documented as a production capability.
   */
  @IsOptional()
  @IsIn(['timeout', 'unavailable', 'refused', 'malformed', 'insufficient_evidence'])
  simulate?: 'timeout' | 'unavailable' | 'refused' | 'malformed' | 'insufficient_evidence';
}
