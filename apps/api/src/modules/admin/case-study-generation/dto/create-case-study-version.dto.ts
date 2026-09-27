import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/// Gate 15 §6: a human-authored CaseStudyVersion - never touches AI
/// generation, created DRAFT and editable until an explicit review action.
export class CreateCaseStudyVersionDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  scenario!: string;

  @IsOptional()
  @IsString()
  context?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  setting?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  participantRoles?: string[];

  @IsOptional()
  @IsString()
  situation?: string;

  @IsOptional()
  @IsString()
  observedIssue?: string;

  @IsString()
  decisionPoint!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  evidencePresentedToLearner?: string[];

  @IsString()
  learnerTask!: string;

  @IsOptional()
  @IsString()
  expectedCompetency?: string;

  @IsOptional()
  @IsString()
  educationalRationale?: string;

  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsUUID()
  learningObjectiveId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  professionalRoleIds?: string[];
}
