import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TaskPriority } from '../../database/entities/task.entity';

export class CreateTaskBatchItemDto {
  @IsString()
  @Length(2, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsEnum(TaskPriority)
  priority!: TaskPriority;
}

export class CreateTaskBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => CreateTaskBatchItemDto)
  tasks!: CreateTaskBatchItemDto[];
}
