import { TaskStatus } from '../database/entities/task.entity';
import { getTaskDueState, normalizeUtcDate } from './task-date';

describe('task date utilities', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');

  it('classifies due dates using UTC calendar-day boundaries', () => {
    expect(
      getTaskDueState(
        {
          status: TaskStatus.Todo,
          dueDate: new Date('2026-08-10T00:00:00Z'),
        },
        now,
      ),
    ).toBe('overdue');
    expect(
      getTaskDueState(
        {
          status: TaskStatus.Todo,
          dueDate: new Date('2026-08-14T00:00:00Z'),
        },
        now,
      ),
    ).toBe('due_soon');
    expect(
      getTaskDueState(
        {
          status: TaskStatus.Done,
          dueDate: new Date('2026-08-10T00:00:00Z'),
        },
        now,
      ),
    ).toBe('normal');
  });

  it('normalizes date-only input to UTC midnight', () => {
    expect(normalizeUtcDate('2026-08-20').toISOString()).toBe(
      '2026-08-20T00:00:00.000Z',
    );
  });
});
