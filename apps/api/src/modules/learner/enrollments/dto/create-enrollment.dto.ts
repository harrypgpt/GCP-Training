import { IsUUID } from 'class-validator';

export class CreateEnrollmentDto {
  @IsUUID()
  programId!: string;

  @IsUUID()
  levelId!: string;
}
