import { TaskPriority } from '../../database/entities/task.entity';

export interface AiTaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
}
