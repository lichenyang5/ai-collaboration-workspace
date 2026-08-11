import { ConflictException } from '@nestjs/common';
import { DataSource, FindOperator, type FindOptionsWhere } from 'typeorm';
import { Project } from '../database/entities/project.entity';
import {
  TaskActivity,
  TaskActivityEventType,
} from '../database/entities/task-activity.entity';
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

describe('TasksService archive summaries', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns an ISO archivedAt string instead of leaking a Date from the service boundary', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-11T12:34:56.000Z'));
    const task = {
      id: 'task-archive-1',
      title: 'Completed task',
      description: 'Archive me',
      priority: TaskPriority.High,
      status: TaskStatus.Done,
      dueDate: null,
      archivedAt: null,
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
      project: { id: 'project-1', team: { id: 'team-1' } },
      assignee: null,
    } as Task;
    const taskRepository = {
      findOne: jest.fn(async () => task),
      save: jest.fn(async (value: Task) => value),
      update: jest.fn(
        async (_criteria: object, changes: { archivedAt: Date | null }) => {
          task.archivedAt = changes.archivedAt;
          return { affected: 1 };
        },
      ),
    };
    const membershipRepository = {
      findOne: jest.fn(async () => ({ id: 'membership-1' })),
    };
    const activityRepository = {
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) => value),
    };
    const transactionGetRepository = jest.fn((entity: unknown) => {
      if (entity === Task) {
        return taskRepository;
      }
      if (entity === TeamMember) {
        return membershipRepository;
      }
      if (entity === TaskActivity) {
        return activityRepository;
      }
      throw new Error('Unexpected repository');
    });
    const dataSource = {
      transaction: jest.fn(
        async (
          callback: (entityManager: {
            getRepository: typeof transactionGetRepository;
          }) => Promise<unknown>,
        ) => callback({ getRepository: transactionGetRepository }),
      ),
    };
    const service = new TasksService(dataSource as unknown as DataSource);

    const summary = await service.setTaskArchived('task-archive-1', true, 'user-1');

    expect(summary.archivedAt).toBe('2026-08-11T12:34:56.000Z');
    expect(typeof summary.archivedAt).toBe('string');
    expect(activityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: TaskActivityEventType.Archived }),
    );
  });

  it('uses the refreshed persisted task after an atomic archive transition', async () => {
    const originalTask = {
      id: 'task-refresh-1',
      title: 'Refresh after archive',
      description: '',
      priority: TaskPriority.Medium,
      status: TaskStatus.Done,
      dueDate: null,
      archivedAt: null,
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      updatedAt: new Date('2026-08-10T01:00:00.000Z'),
      project: { id: 'project-1', team: { id: 'team-1' } },
      assignee: null,
    } as Task;
    const refreshedTask = {
      ...originalTask,
      archivedAt: new Date('2026-08-11T12:34:56.000Z'),
      updatedAt: new Date('2026-08-11T12:34:56.000Z'),
    } as Task;
    const taskRepository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(originalTask)
        .mockResolvedValueOnce(refreshedTask),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const membershipRepository = {
      findOne: jest.fn(async () => ({ id: 'membership-1' })),
    };
    const activityRepository = {
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) => value),
    };
    const transactionGetRepository = jest.fn((entity: unknown) => {
      if (entity === Task) {
        return taskRepository;
      }
      if (entity === TeamMember) {
        return membershipRepository;
      }
      if (entity === TaskActivity) {
        return activityRepository;
      }
      throw new Error('Unexpected repository');
    });
    const dataSource = {
      transaction: jest.fn(
        async (
          callback: (entityManager: {
            getRepository: typeof transactionGetRepository;
          }) => Promise<unknown>,
        ) => callback({ getRepository: transactionGetRepository }),
      ),
    };
    const service = new TasksService(dataSource as unknown as DataSource);

    const summary = await service.setTaskArchived(
      'task-refresh-1',
      true,
      'user-1',
    );

    expect(taskRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: { id: 'task-refresh-1' },
      relations: { project: { team: true }, assignee: true },
    });
    expect(summary.updatedAt).toEqual(
      new Date('2026-08-11T12:34:56.000Z'),
    );
    expect(activityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ task: refreshedTask }),
    );
  });
});

describe('TasksService concurrent archive transitions', () => {
  it.each([
    {
      label: 'archive',
      archived: true,
      initialArchivedAt: null,
      expectedEventType: TaskActivityEventType.Archived,
    },
    {
      label: 'restore',
      archived: false,
      initialArchivedAt: new Date('2026-08-11T10:00:00.000Z'),
      expectedEventType: TaskActivityEventType.Restored,
    },
  ])(
    'atomically serializes concurrent $label requests so only one transition and activity succeed',
    async ({ archived, initialArchivedAt, expectedEventType }) => {
      let persistedArchivedAt = initialArchivedAt;
      const taskFixture = (): Task =>
        ({
          id: 'task-concurrent-1',
          title: 'Concurrent task',
          description: '',
          priority: TaskPriority.Medium,
          status: TaskStatus.Done,
          dueDate: null,
          archivedAt: persistedArchivedAt,
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
          updatedAt: new Date('2026-08-10T00:00:00.000Z'),
          project: { id: 'project-1', team: { id: 'team-1' } },
          assignee: null,
        }) as Task;
      const taskRepository = {
        findOne: jest.fn(async () => taskFixture()),
        save: jest.fn(async (task: Task) => task),
        update: jest.fn(
          async (
            criteria: { archivedAt?: FindOperator<Date | null> },
            changes: { archivedAt: Date | null },
          ) => {
            const archivedAtCondition = criteria.archivedAt;
            const expectsActive = archivedAtCondition?.type === 'isNull';
            const expectsArchived =
              archivedAtCondition?.type === 'not' &&
              (archivedAtCondition.child as FindOperator<Date | null> | undefined)
                ?.type === 'isNull';
            const matchesCurrentState = archived
              ? expectsActive && persistedArchivedAt === null
              : expectsArchived && persistedArchivedAt !== null;

            if (!matchesCurrentState) {
              return { affected: 0 };
            }
            persistedArchivedAt = changes.archivedAt;
            return { affected: 1 };
          },
        ),
      };
      const membershipRepository = {
        findOne: jest.fn(async () => ({ id: 'membership-1' })),
      };
      const activityRepository = {
        create: jest.fn((value: object) => value),
        save: jest.fn(async (value: object) => value),
      };
      const getRepository = jest.fn((entity: unknown) => {
        if (entity === Task) {
          return taskRepository;
        }
        if (entity === TeamMember) {
          return membershipRepository;
        }
        if (entity === TaskActivity) {
          return activityRepository;
        }
        throw new Error('Unexpected repository');
      });
      const dataSource = {
        transaction: jest.fn(
          async (
            callback: (manager: { getRepository: typeof getRepository }) => Promise<unknown>,
          ) => callback({ getRepository }),
        ),
      };
      const service = new TasksService(dataSource as unknown as DataSource);

      const results = await Promise.allSettled([
        service.setTaskArchived('task-concurrent-1', archived, 'user-1'),
        service.setTaskArchived('task-concurrent-1', archived, 'user-1'),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: expect.any(ConflictException),
      });
      expect(taskRepository.update).toHaveBeenCalledTimes(2);
      expect(taskRepository.save).not.toHaveBeenCalled();
      expect(activityRepository.save).toHaveBeenCalledTimes(1);
      expect(activityRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: expectedEventType }),
      );
    },
  );
});

describe('TasksService mutation and archive serialization', () => {
  it('rejects a stale status write when a concurrent archive wins', async () => {
    const persistedTask = mutationTask();
    const archivedAt = new Date('2026-08-11T12:00:00.000Z');
    const taskRepository = {
      findOne: jest.fn(async () => ({ ...persistedTask } as Task)),
      update: jest.fn(
        async (
          criteria: { archivedAt?: FindOperator<Date | null> },
          changes: { status?: TaskStatus },
        ) => {
          if (
            criteria.archivedAt?.type !== 'isNull' ||
            persistedTask.archivedAt !== null
          ) {
            return { affected: 0 };
          }
          persistedTask.status = changes.status ?? persistedTask.status;
          return { affected: 1 };
        },
      ),
      save: jest.fn(async (task: Task) => Object.assign(persistedTask, task)),
    };
    const membershipRepository = {
      findOne: jest.fn(async () => {
        persistedTask.archivedAt = archivedAt;
        return { id: 'membership-1' };
      }),
    };
    const activityRepository = mutationActivityRepository();
    const service = mutationService(
      taskRepository,
      membershipRepository,
      activityRepository,
    );

    await expect(
      service.updateTaskStatus(
        persistedTask.id,
        TaskStatus.InProgress,
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(taskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: persistedTask.id,
        archivedAt: expect.objectContaining({ type: 'isNull' }),
      }),
      expect.objectContaining({ status: TaskStatus.InProgress }),
    );
    expect(taskRepository.save).not.toHaveBeenCalled();
    expect(activityRepository.save).not.toHaveBeenCalled();
    expect(persistedTask.status).toBe(TaskStatus.Done);
    expect(persistedTask.archivedAt).toBe(archivedAt);
  });

  it('uses the refreshed status entity and prevents a later archive from winning', async () => {
    const persistedTask = mutationTask();
    const refreshedAt = new Date('2026-08-11T12:30:00.000Z');
    const taskRepository = {
      findOne: jest.fn(async () => ({ ...persistedTask } as Task)),
      update: jest.fn(
        async (
          criteria: {
            archivedAt?: FindOperator<Date | null>;
            status?: TaskStatus;
          },
          changes: { archivedAt?: Date | null; status?: TaskStatus },
        ) => {
          if (criteria.archivedAt?.type !== 'isNull' || persistedTask.archivedAt) {
            return { affected: 0 };
          }
          if (criteria.status && criteria.status !== persistedTask.status) {
            return { affected: 0 };
          }
          if (Object.prototype.hasOwnProperty.call(changes, 'archivedAt')) {
            persistedTask.archivedAt = changes.archivedAt ?? null;
          }
          if (changes.status) {
            persistedTask.status = changes.status;
          }
          persistedTask.updatedAt = refreshedAt;
          return { affected: 1 };
        },
      ),
      save: jest.fn(async (task: Task) => Object.assign(persistedTask, task)),
    };
    const membershipRepository = {
      findOne: jest.fn(async () => ({ id: 'membership-1' })),
    };
    const activityRepository = mutationActivityRepository();
    const service = mutationService(
      taskRepository,
      membershipRepository,
      activityRepository,
    );

    const summary = await service.updateTaskStatus(
      persistedTask.id,
      TaskStatus.InProgress,
      'user-1',
    );
    await expect(
      service.setTaskArchived(persistedTask.id, true, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(summary.updatedAt).toEqual(refreshedAt);
    expect(taskRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: { id: persistedTask.id },
      relations: { project: { team: true }, assignee: true },
    });
    expect(activityRepository.save).toHaveBeenCalledTimes(1);
    expect(activityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: TaskActivityEventType.StatusChanged,
        task: expect.objectContaining({ updatedAt: refreshedAt }),
      }),
    );
    expect(persistedTask.status).toBe(TaskStatus.InProgress);
    expect(persistedTask.archivedAt).toBeNull();
  });

  it('rejects a stale detail write when a concurrent archive wins', async () => {
    const persistedTask = mutationTask();
    const archivedAt = new Date('2026-08-11T13:00:00.000Z');
    const taskRepository = {
      findOne: jest.fn(async () => ({ ...persistedTask } as Task)),
      update: jest.fn(
        async (criteria: { archivedAt?: FindOperator<Date | null> }) => ({
          affected:
            criteria.archivedAt?.type === 'isNull' &&
            persistedTask.archivedAt === null
              ? 1
              : 0,
        }),
      ),
      save: jest.fn(async (task: Task) => Object.assign(persistedTask, task)),
    };
    const membershipRepository = {
      findOne: jest.fn(async () => {
        persistedTask.archivedAt = archivedAt;
        return { id: 'membership-1' };
      }),
    };
    const activityRepository = mutationActivityRepository();
    const service = mutationService(
      taskRepository,
      membershipRepository,
      activityRepository,
    );

    await expect(
      service.updateTask(
        persistedTask.id,
        { title: 'Late stale title' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(taskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: persistedTask.id,
        archivedAt: expect.objectContaining({ type: 'isNull' }),
      }),
      expect.objectContaining({ title: 'Late stale title' }),
    );
    expect(taskRepository.save).not.toHaveBeenCalled();
    expect(activityRepository.save).not.toHaveBeenCalled();
    expect(persistedTask.title).toBe('Original task');
    expect(persistedTask.status).toBe(TaskStatus.Done);
    expect(persistedTask.archivedAt).toBe(archivedAt);
  });

  it('uses the refreshed detail entity before a later archive succeeds', async () => {
    const persistedTask = mutationTask();
    const editUpdatedAt = new Date('2026-08-11T13:30:00.000Z');
    const archiveUpdatedAt = new Date('2026-08-11T13:31:00.000Z');
    const taskRepository = {
      findOne: jest.fn(async () => ({ ...persistedTask } as Task)),
      update: jest.fn(
        async (
          criteria: {
            archivedAt?: FindOperator<Date | null>;
            status?: TaskStatus;
          },
          changes: { archivedAt?: Date | null; title?: string },
        ) => {
          if (criteria.archivedAt?.type !== 'isNull' || persistedTask.archivedAt) {
            return { affected: 0 };
          }
          if (criteria.status && criteria.status !== persistedTask.status) {
            return { affected: 0 };
          }
          if (changes.title) {
            persistedTask.title = changes.title;
            persistedTask.updatedAt = editUpdatedAt;
          }
          if (Object.prototype.hasOwnProperty.call(changes, 'archivedAt')) {
            persistedTask.archivedAt = changes.archivedAt ?? null;
            persistedTask.updatedAt = archiveUpdatedAt;
          }
          return { affected: 1 };
        },
      ),
      save: jest.fn(async (task: Task) => Object.assign(persistedTask, task)),
    };
    const membershipRepository = {
      findOne: jest.fn(async () => ({ id: 'membership-1' })),
    };
    const activityRepository = mutationActivityRepository();
    const service = mutationService(
      taskRepository,
      membershipRepository,
      activityRepository,
    );

    const editSummary = await service.updateTask(
      persistedTask.id,
      { title: 'Atomic title' },
      'user-1',
    );
    const archiveSummary = await service.setTaskArchived(
      persistedTask.id,
      true,
      'user-1',
    );

    expect(editSummary.updatedAt).toEqual(editUpdatedAt);
    expect(archiveSummary.status).toBe(TaskStatus.Done);
    expect(archiveSummary.archivedAt).not.toBeNull();
    expect(taskRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: { id: persistedTask.id },
      relations: { project: { team: true }, assignee: true },
    });
    expect(activityRepository.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: TaskActivityEventType.Updated,
        task: expect.objectContaining({ updatedAt: editUpdatedAt }),
      }),
    );
    expect(persistedTask.title).toBe('Atomic title');
    expect(persistedTask.status).toBe(TaskStatus.Done);
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

function mutationTask(): Task {
  return {
    id: 'task-mutation-1',
    title: 'Original task',
    description: 'Original description',
    priority: TaskPriority.Medium,
    status: TaskStatus.Done,
    dueDate: null,
    archivedAt: null,
    createdAt: new Date('2026-08-10T00:00:00.000Z'),
    updatedAt: new Date('2026-08-10T01:00:00.000Z'),
    project: { id: 'project-1', team: { id: 'team-1' } },
    assignee: null,
  } as Task;
}

function mutationActivityRepository(): {
  create: jest.Mock;
  save: jest.Mock;
} {
  return {
    create: jest.fn((value: object) => value),
    save: jest.fn(async (value: object) => value),
  };
}

function mutationService(
  taskRepository: { findOne: jest.Mock; update: jest.Mock; save: jest.Mock },
  membershipRepository: { findOne: jest.Mock },
  activityRepository: { create: jest.Mock; save: jest.Mock },
): TasksService {
  const getRepository = jest.fn((entity: unknown) => {
    if (entity === Task) {
      return taskRepository;
    }
    if (entity === TeamMember) {
      return membershipRepository;
    }
    if (entity === TaskActivity) {
      return activityRepository;
    }
    throw new Error('Unexpected repository');
  });
  const dataSource = {
    transaction: jest.fn(
      async (
        callback: (manager: { getRepository: typeof getRepository }) => Promise<unknown>,
      ) => callback({ getRepository }),
    ),
  };
  return new TasksService(dataSource as unknown as DataSource);
}
