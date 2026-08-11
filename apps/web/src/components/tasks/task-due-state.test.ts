import { describe, expect, it } from 'vitest';
import { getTaskDueLabel } from './task-due-state';

describe('getTaskDueLabel', () => {
  const today = '2026-08-11';

  it.each([
    ['today', { status: 'todo', dueDate: '2026-08-11T00:00:00.000Z' }, '今日到期'],
    [
      'within the next three days',
      { status: 'in_progress', dueDate: '2026-08-14T00:00:00.000Z' },
      '三天内到期',
    ],
    ['overdue', { status: 'todo', dueDate: '2026-08-10T00:00:00.000Z' }, '已逾期'],
    ['no date', { status: 'todo', dueDate: null }, null],
    ['four days later', { status: 'todo', dueDate: '2026-08-15T00:00:00.000Z' }, null],
    ['completed', { status: 'done', dueDate: '2026-08-10T00:00:00.000Z' }, null],
  ] as const)('returns %s label from a UTC calendar date', (_caseName, task, expected) => {
    expect(getTaskDueLabel(task, today)).toBe(expected);
  });
});
