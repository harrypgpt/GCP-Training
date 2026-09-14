import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateObjectiveDto {
  @IsUUID()
  lessonId!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
