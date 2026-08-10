import { IsString, Length } from 'class-validator';

export class GenerateTaskDraftsDto {
  @IsString()
  @Length(10, 2000)
  goal!: string;
}
