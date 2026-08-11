import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TaskPriority } from '../../database/entities/task.entity';
import type { TaskDueFilter } from '../task-date';

export type TaskBoardView = 'active' | 'archived';

export class TaskBoardQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== 'unassigned')
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsIn(['unset', 'normal', 'due_soon', 'overdue'])
  due?: TaskDueFilter;

  @IsOptional()
  @IsIn(['active', 'archived'])
  view: TaskBoardView = 'active';
}
