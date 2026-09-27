import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateDomainRoleMapDto {
  @IsUUID()
  domainId!: string;

  @IsUUID()
  professionalRoleId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rationale?: string;
}
