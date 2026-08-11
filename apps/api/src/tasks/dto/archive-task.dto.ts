import { IsBoolean } from 'class-validator';

export class ArchiveTaskDto {
  @IsBoolean()
  archived!: boolean;
}
