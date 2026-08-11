import type { TaskSummary } from '../../types/workspace';

function toUtcDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return null;
  }

  return Math.floor(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
      (24 * 60 * 60 * 1000),
  );
}

export function getTaskDueLabel(
  task: Pick<TaskSummary, 'status' | 'dueDate'>,
  today: string,
): string | null {
  if (task.status === 'done' || !task.dueDate) {
    return null;
  }

  const dueDay = toUtcDayNumber(task.dueDate);
  const todayDay = toUtcDayNumber(today);
  if (dueDay === null || todayDay === null) {
    return null;
  }

  const daysUntilDue = dueDay - todayDay;
  if (daysUntilDue < 0) {
    return '已逾期';
  }

  if (daysUntilDue === 0) {
    return '今日到期';
  }

  if (daysUntilDue <= 3) {
    return '三天内到期';
  }

  return null;
}
