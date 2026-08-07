import { IsEnum } from 'class-validator';
import { TaskStatus } from '../../database/entities/task.entity';

export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus)
  status!: TaskStatus;
}