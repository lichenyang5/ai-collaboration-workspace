import { DataSource, FindOperator, type FindOptionsWhere } from 'typeorm';
import { Project } from '../database/entities/project.entity';
import { Task, TaskPriority, TaskStatus } from '../database/entities/task.entity';
import { TeamMember } from '../database/entities/team-member.entity';
import { TaskBoardQueryDto } from './dto/task-board-query.dto';
import { TasksService } from './tasks.service';

describe('TasksService board filters', () => {
  const project = {
    id: 'project-1',
    name: 'Project one',
    team: { id: 'team-1' },
  } as Project;
  let taskRepository: { find: jest.Mock };
  let service: TasksService;

  beforeEach(() => {
    taskRepository = {
      find: jest.fn(async () => []),
    };
    const projectRepository = {
      findOne: jest.fn(async () => project),
    };
    const membershipRepository = {
      findOne: jest.fn(async () => ({ id: 'membership-1' })),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Task) {
          return taskRepository;
        }
        if (entity === Project) {
          return projectRepository;
        }
        if (entity === TeamMember) {
          return membershipRepository;
        }
        throw new Error('Unexpected repository');
      }),
    };
    service = new TasksService(dataSource as unknown as DataSource);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses inclusive UTC-today and exclusive day-after-due-soon boundaries', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-11T12:00:00.000Z'));

    await service.getTaskBoard(
      'project-1',
      'user-1',
      boardQuery({ due: 'due_soon' }),
    );

    const dueSoonWhere = getLastWhere(taskRepository)[0];
    const dueSoonDate = asOperator(dueSoonWhere.dueDate);
    expect(dueSoonDate.type).toBe('and');
    const [todayOrLater, beforeDayAfterDueSoon] = dueSoonDate.value as FindOperator<Date>[];
    expect(todayOrLater.type).toBe('moreThanOrEqual');
    expect(todayOrLater.value).toEqual(new Date('2026-08-11T00:00:00.000Z'));
    expect(beforeDayAfterDueSoon.type).toBe('lessThan');
    expect(beforeDayAfterDueSoon.value).toEqual(
      new Date('2026-08-15T00:00:00.000Z'),
    );

    await service.getTaskBoard(
      'project-1',
      'user-1',
      boardQuery({ due: 'normal' }),
    );

    const normalWhere = getLastWhere(taskRepository);
    const incompleteNormal = normalWhere.find(
      (condition) => asOperator(condition.status).type === 'not',
    );
    expect(incompleteNormal).toBeDefined();
    const normalDate = asOperator(incompleteNormal?.dueDate);
    expect(normalDate.type).toBe('moreThanOrEqual');
    expect(normalDate.value).toEqual(new Date('2026-08-15T00:00:00.000Z'));
  });

  it('retains all non-text filters in keyword branches and selects the requested archive view', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-11T12:00:00.000Z'));

    await service.getTaskBoard(
      'project-1',
      'user-1',
      boardQuery({
        q: '接口',
        assigneeId: 'unassigned',
        priority: TaskPriority.High,
        due: 'overdue',
      }),
    );

    const activeKeywordWhere = getLastWhere(taskRepository);
    expect(activeKeywordWhere).toHaveLength(2);
    for (const condition of activeKeywordWhere) {
      expect(condition.project).toMatchObject({ id: 'project-1' });
      expect(asOperator(condition.archivedAt).type).toBe('isNull');
      expect(asOperator(condition.assignee).type).toBe('isNull');
      expect(condition.priority).toBe(TaskPriority.High);
      expect(asOperator(condition.status).type).toBe('not');
      expect(asOperator(condition.dueDate).type).toBe('lessThan');
    }
    expect(asOperator(activeKeywordWhere[0].title).type).toBe('ilike');
    expect(asOperator(activeKeywordWhere[1].description).type).toBe('ilike');

    await service.getTaskBoard(
      'project-1',
      'user-1',
      boardQuery({ assigneeId: 'unassigned', view: 'archived' }),
    );

    const [archivedWhere] = getLastWhere(taskRepository);
    expect(asOperator(archivedWhere.archivedAt).type).toBe('not');
    expect(asOperator(archivedWhere.archivedAt).child?.type).toBe('isNull');
    expect(asOperator(archivedWhere.assignee).type).toBe('isNull');
  });
});

function getLastWhere(
  taskRepository: { find: jest.Mock },
): FindOptionsWhere<Task>[] {
  const calls = taskRepository.find.mock.calls;
  const options = calls[calls.length - 1][0] as {
    where: FindOptionsWhere<Task>[];
  };
  return options.where;
}

function asOperator(value: unknown): FindOperator<unknown> {
  return value as FindOperator<unknown>;
}

function boardQuery(input: Partial<TaskBoardQueryDto>): TaskBoardQueryDto {
  return Object.assign(new TaskBoardQueryDto(), input);
}
