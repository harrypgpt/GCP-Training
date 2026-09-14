import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** Reorders all siblings under one parent in a single call. */
export class ReorderDto {
  @IsUUID()
  parentId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  orderedIds!: string[];
}
