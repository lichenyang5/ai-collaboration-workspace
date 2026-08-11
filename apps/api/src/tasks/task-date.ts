import { Task, TaskStatus } from '../database/entities/task.entity';

export type TaskDueFilter = 'unset' | 'normal' | 'due_soon' | 'overdue';

export function normalizeUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function getTaskDueState(
  task: Pick<Task, 'status' | 'dueDate'>,
  now: Date,
): TaskDueFilter {
  if (!task.dueDate) {
    return 'unset';
  }

  if (task.status === TaskStatus.Done) {
    return 'normal';
  }

  const today = normalizeUtcDate(now.toISOString().slice(0, 10));
  const dueDate = normalizeUtcDate(task.dueDate.toISOString().slice(0, 10));
  if (dueDate < today) {
    return 'overdue';
  }

  const dueSoonEnd = new Date(today);
  dueSoonEnd.setUTCDate(today.getUTCDate() + 3);
  return dueDate <= dueSoonEnd ? 'due_soon' : 'normal';
}
