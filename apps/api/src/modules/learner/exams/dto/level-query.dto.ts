import { IsUUID } from 'class-validator';

export class LevelQueryDto {
  @IsUUID()
  levelId!: string;
}
