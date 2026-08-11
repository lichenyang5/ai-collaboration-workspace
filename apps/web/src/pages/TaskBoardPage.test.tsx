import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TaskBoardPage } from './TaskBoardPage';
import type { TaskBoardResponse, TaskSummary } from '../types/workspace';

const createdAt = '2026-08-07T07:00:00.000Z';

function createTask(
  id: string,
  title: string,
  status: TaskSummary['status'],
): TaskSummary {
  return {
    id,
    title,
    description: '',
    status,
    priority: 'medium',
    dueDate: null,
    archivedAt: null,
    createdAt,
    assignee: null,
  };
}

function createBoard(
  tasks: Partial<Record<TaskSummary['status'], TaskSummary[]>> = {},
): TaskBoardResponse {
  return {
    projectId: 'project-1',
    projectName: '任务协作平台',
    teamId: 'team-1',
    columns: {
      todo: tasks.todo ?? [],
      in_progress: tasks.in_progress ?? [],
      done: tasks.done ?? [],
    },
  };
}

function createActivity(
  id: string,
  eventType: string,
  title: string,
  details: Record<string, unknown> = {},
) {
  return {
    id,
    eventType,
    details,
    createdAt,
    task: { id: `task-${id}`, title },
    actor: {
      id: 'actor-1',
      displayName: '王小明',
      email: 'wang@example.com',
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="board-location">{location.pathname}{location.search}</output>;
}

function renderBoard(entry = '/projects/project-1/board') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/projects/:projectId/board" element={<TaskBoardPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('TaskBoardPage', () => {
  it('loads tasks into todo, in progress, and done columns', async () => {
    const board = createBoard({
      todo: [createTask('task-1', '梳理项目接口', 'todo')],
      in_progress: [createTask('task-2', '实现登录页面', 'in_progress')],
      done: [createTask('task-3', '发布第一版', 'done')],
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(board), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderBoard();

    expect(
      await screen.findByRole('heading', { name: '任务协作平台' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: /待办/ })).toHaveTextContent(
      '梳理项目接口',
    );
    expect(screen.queryByText('实现登录页面')).not.toBeInTheDocument();
    expect(screen.queryByText('发布第一版')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '待办 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: '进行中 1' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByLabelText('任务标题')).toBeInTheDocument();
    expect(screen.getByLabelText('任务说明')).toBeInTheDocument();
    expect(screen.getByLabelText('优先级')).toBeInTheDocument();
  });

  it('switches the visible task list by status without reloading the board', async () => {
    const board = createBoard({
      todo: [createTask('task-todo', '待办任务标题', 'todo')],
      in_progress: [
        createTask('task-progress', '进行中任务标题', 'in_progress'),
      ],
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(board), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    expect(await screen.findByText('待办任务标题')).toBeInTheDocument();
    expect(screen.queryByText('进行中任务标题')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '进行中 1' }));

    expect(screen.getByText('进行中任务标题')).toBeInTheDocument();
    expect(screen.queryByText('待办任务标题')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/api/projects/project-1/tasks'),
      ),
    ).toHaveLength(1);
  });

  it('restores supported filters from the URL and sends them with the board request', async () => {
    const board = createBoard({
      todo: [createTask('task-filtered', '接口筛选结果', 'todo')],
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/teams/team-1/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(board), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderBoard(
      '/projects/project-1/board?q=接口&priority=high&due=overdue',
    );

    await screen.findByText('接口筛选结果');

    expect(screen.getByLabelText('关键词')).toHaveValue('接口');
    expect(screen.getByLabelText('筛选优先级')).toHaveValue('high');
    expect(screen.getByLabelText('截止状态')).toHaveValue('overdue');

    const boardRequest = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/api/projects/project-1/tasks'),
    );
    expect(boardRequest).toBeDefined();
    const boardUrl = new URL(String(boardRequest?.[0]));
    expect(boardUrl.searchParams.get('q')).toBe('接口');
    expect(boardUrl.searchParams.get('priority')).toBe('high');
    expect(boardUrl.searchParams.get('due')).toBe('overdue');
  });

  it('removes empty and unsupported filter parameters from the initial URL while preserving a supported view', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/teams/team-1/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(createBoard()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderBoard(
      '/projects/project-1/board?q=%20%20&priority=urgent&due=tomorrow&view=archived&assigneeId=not-a-uuid',
    );

    await screen.findByRole('heading', { name: '任务协作平台' });
    await waitFor(() => {
      expect(screen.getByTestId('board-location')).toHaveTextContent(
        '/projects/project-1/board?view=archived',
      );
    });
  });

  it('debounces a keyword filter for 250 ms before issuing one new board request', async () => {
    const board = createBoard({
      todo: [createTask('task-debounced', '初始任务', 'todo')],
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/teams/team-1/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(board), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderBoard();
    await screen.findByText('初始任务');
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('关键词'), {
      target: { value: '新的关键词' },
    });

    const boardRequests = () =>
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/api/projects/project-1/tasks'),
      );
    expect(boardRequests()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(boardRequests()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(boardRequests()).toHaveLength(2);
    expect(
      new URL(String(boardRequests()[1]?.[0])).searchParams.get('q'),
    ).toBe('新的关键词');
  });

  it('waits for a pending keyword debounce before requesting a changed priority filter', async () => {
    const board = createBoard({
      todo: [createTask('task-filter-race', '筛选竞态任务', 'todo')],
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/teams/team-1/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(board), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderBoard();
    await screen.findByText('筛选竞态任务');
    vi.useFakeTimers();

    const boardRequests = () =>
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/api/projects/project-1/tasks'),
      );
    expect(boardRequests()).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('关键词'), {
      target: { value: '新关键词' },
    });
    fireEvent.change(screen.getByLabelText('筛选优先级'), {
      target: { value: 'high' },
    });

    expect(boardRequests()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(boardRequests()).toHaveLength(2);
    const finalRequest = new URL(String(boardRequests()[1]?.[0]));
    expect(finalRequest.searchParams.get('q')).toBe('新关键词');
    expect(finalRequest.searchParams.get('priority')).toBe('high');
  });

  it('keeps the last successful board visible when filtering fails and retries it on request', async () => {
    const board = createBoard({
      todo: [createTask('task-stable', '保留的任务卡片', 'todo')],
    });
    let boardRequestCount = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/teams/team-1/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/api/projects/project-1/task-activities')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.includes('/api/projects/project-1/tasks')) {
          boardRequestCount += 1;
          if (boardRequestCount === 2) {
            return new Response(JSON.stringify({ message: '筛选加载失败' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }

        return new Response(JSON.stringify(board), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText('保留的任务卡片');
    await user.selectOptions(screen.getByLabelText('筛选优先级'), 'high');

    expect(await screen.findByRole('alert')).toHaveTextContent('筛选加载失败');
    expect(screen.getByText('保留的任务卡片')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重新加载' }));

    await waitFor(() => {
      expect(boardRequestCount).toBe(3);
    });
    expect(screen.getByText('保留的任务卡片')).toBeInTheDocument();
  });

  it('adds a created task to the todo column', async () => {
    const createdTask = createTask('task-4', '实现任务创建', 'todo');
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith('/api/projects/project-1/tasks') &&
          init?.method === 'POST'
        ) {
          return new Response(JSON.stringify(createdTask), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(createBoard()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByRole('heading', { name: '项目任务看板' });
    await user.type(screen.getByLabelText('任务标题'), '实现任务创建');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(
      await within(screen.getByRole('tabpanel', { name: /待办/ })).findByText(
        '实现任务创建',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建任务' })).toBeEnabled();
  });

  it('sends a creation due date and clears it after the task is created', async () => {
    const createdTask = {
      ...createTask('task-due-date', '带截止日期的任务', 'todo'),
      dueDate: '2026-08-14T00:00:00.000Z',
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith('/api/projects/project-1/tasks') &&
          init?.method === 'POST'
        ) {
          return new Response(JSON.stringify(createdTask), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.endsWith('/api/teams/team-1/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(createBoard()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByRole('heading', { name: '项目任务看板' });
    await user.type(screen.getByLabelText('任务标题'), '带截止日期的任务');
    const dueDateInput = screen.getByLabelText('截止日期');
    await user.type(dueDateInput, '2026-08-14');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(
      await screen.findByText('带截止日期的任务'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/projects\/project-1\/tasks$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: '带截止日期的任务',
          description: '',
          priority: 'medium',
          dueDate: '2026-08-14',
        }),
      }),
    );
    expect(dueDateInput).toHaveValue('');
  });

  it('moves a task to the requested status after the server accepts the update', async () => {
    const task = createTask('task-1', '梳理项目接口', 'todo');
    const movedTask = { ...task, status: 'in_progress' as const };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith('/api/tasks/task-1/status') &&
          init?.method === 'PATCH'
        ) {
          return new Response(JSON.stringify(movedTask), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(createBoard({ todo: [task] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('梳理项目接口');
    await user.click(
      screen.getByRole('button', { name: '移动“梳理项目接口”到进行中' }),
    );

    await user.click(screen.getByRole('tab', { name: /进行中/ }));
    await waitFor(() => {
      expect(
        screen.getByRole('tabpanel', { name: /进行中/ }),
      ).toHaveTextContent('梳理项目接口');
    });
    expect(screen.queryByText('梳理项目接口')).toBeInTheDocument();
  });

  it('updates the task card after editing its details', async () => {
    const task = createTask('task-1', '梳理项目接口', 'todo');
    const updatedTask = {
      ...task,
      title: '更新接口文档',
      description: '补充接口交付说明',
      priority: 'high' as const,
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/tasks/task-1') && init?.method === 'PATCH') {
          return new Response(JSON.stringify(updatedTask), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(createBoard({ todo: [task] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('梳理项目接口');
    await user.click(
      screen.getByRole('button', { name: '编辑详情：梳理项目接口' }),
    );
    const titleInput = screen.getByLabelText('编辑任务标题');
    await user.clear(titleInput);
    await user.type(titleInput, '更新接口文档');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('更新接口文档')).toBeInTheDocument();
    expect(screen.getByText('补充接口交付说明')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/tasks\/task-1$/),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          title: '更新接口文档',
          description: '',
          priority: 'medium',
          assigneeId: null,
          dueDate: null,
        }),
      }),
    );
  });

  it('disables every card edit and move action while saving an edit is pending', async () => {
    const firstTask = createTask('task-save-1', '第一个待办任务', 'todo');
    const secondTask = createTask('task-save-2', '第二个待办任务', 'todo');
    const saveResponse = createDeferred<Response>();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/tasks/task-save-1') && init?.method === 'PATCH') {
          return saveResponse.promise;
        }
        if (url.endsWith('/api/teams/team-1/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(
          JSON.stringify(createBoard({ todo: [firstTask, secondTask] })),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText('第一个待办任务');
    await user.click(
      screen.getByRole('button', { name: '编辑详情：第一个待办任务' }),
    );
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    try {
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
      });
      expect(
        screen.getByRole('button', { name: '编辑详情：第一个待办任务' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: '移动“第一个待办任务”到进行中' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: '编辑详情：第二个待办任务' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: '移动“第二个待办任务”到进行中' }),
      ).toBeDisabled();
    } finally {
      await act(async () => {
        saveResponse.resolve(
          new Response(JSON.stringify(firstTask), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
        await Promise.resolve();
      });
    }
  });

  it('does not let a stale filter response overwrite a successful task mutation', async () => {
    const originalTask = createTask('task-stale-board', '不会被旧快照覆盖', 'todo');
    const movedTask = { ...originalTask, status: 'in_progress' as const };
    const staleBoardResponse = createDeferred<Response>();
    let boardRequestCount = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/teams/team-1/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.endsWith('/api/projects/project-1/task-activities')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (
          url.endsWith('/api/tasks/task-stale-board/status') &&
          init?.method === 'PATCH'
        ) {
          return new Response(JSON.stringify(movedTask), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.includes('/api/projects/project-1/tasks')) {
          boardRequestCount += 1;
          if (boardRequestCount === 2) {
            return staleBoardResponse.promise;
          }
        }

        return new Response(
          JSON.stringify(createBoard({ todo: [originalTask] })),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText('不会被旧快照覆盖');
    fireEvent.change(screen.getByLabelText('筛选优先级'), {
      target: { value: 'high' },
    });
    await waitFor(() => {
      expect(boardRequestCount).toBe(2);
    });

    await user.click(
      screen.getByRole('button', { name: '移动“不会被旧快照覆盖”到进行中' }),
    );
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '进行中 1' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: '进行中 1' }));
    expect(
      screen.getByRole('tabpanel', { name: /进行中/ }),
    ).toHaveTextContent('不会被旧快照覆盖');

    await act(async () => {
      staleBoardResponse.resolve(
        new Response(JSON.stringify(createBoard({ todo: [originalTask] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByRole('tabpanel', { name: /进行中/ }),
      ).toHaveTextContent('不会被旧快照覆盖');
    });
  });

  it('does not send an update request when task detail editing is cancelled', async () => {
    const task = createTask('task-1', '梳理项目接口', 'todo');
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(createBoard({ todo: [task] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('梳理项目接口');
    await user.click(
      screen.getByRole('button', { name: '编辑详情：梳理项目接口' }),
    );
    await user.click(screen.getByRole('button', { name: '取消编辑' }));

    expect(
      screen.queryByRole('button', { name: '保存修改' }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith('/api/tasks/task-1') &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('keeps task detail form values when saving changes fails', async () => {
    const task = createTask('task-1', '梳理项目接口', 'todo');
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/tasks/task-1') && init?.method === 'PATCH') {
          return new Response(JSON.stringify({ message: '任务详情保存失败' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(createBoard({ todo: [task] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('梳理项目接口');
    await user.click(
      screen.getByRole('button', { name: '编辑详情：梳理项目接口' }),
    );
    const titleInput = screen.getByLabelText('编辑任务标题');
    await user.clear(titleInput);
    await user.type(titleInput, '保留编辑内容');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '任务详情保存失败',
    );
    expect(titleInput).toHaveValue('保留编辑内容');
    expect(screen.getByRole('button', { name: '保存修改' })).toBeEnabled();
  });

  it('keeps the task form values when creating a task fails', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith('/api/projects/project-1/tasks') &&
          init?.method === 'POST'
        ) {
          return new Response(JSON.stringify({ message: '任务创建失败' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(createBoard()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByRole('heading', { name: '项目任务看板' });
    const titleInput = screen.getByLabelText('任务标题');
    await user.type(titleInput, '保留输入内容');
    const dueDateInput = screen.getByLabelText('截止日期');
    await user.type(dueDateInput, '2026-08-14');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('任务创建失败');
    expect(titleInput).toHaveValue('保留输入内容');
    expect(dueDateInput).toHaveValue('2026-08-14');
    expect(screen.getByRole('button', { name: '创建任务' })).toBeEnabled();
  });

  it('assigns a created task to a selected team member and shows the assignee', async () => {
    const assignee = {
      id: '11111111-1111-4111-8111-111111111111',
      displayName: '成员一',
      email: 'member@example.com',
      role: 'member' as const,
    };
    const createdTask = {
      ...createTask('task-5', '分配负责人任务', 'todo'),
      assignee: {
        id: assignee.id,
        displayName: assignee.displayName,
        email: assignee.email,
      },
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/teams/team-1/members')) {
          return new Response(JSON.stringify([assignee]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (
          url.endsWith('/api/projects/project-1/tasks') &&
          init?.method === 'POST'
        ) {
          return new Response(JSON.stringify(createdTask), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(createBoard()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    const assigneeSelect = screen.getByRole('combobox', { name: '负责人' });
    expect(
      await within(assigneeSelect).findByRole('option', { name: '成员一' }),
    ).toBeInTheDocument();
    await user.selectOptions(assigneeSelect, assignee.id);
    await user.type(screen.getByLabelText('任务标题'), '分配负责人任务');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(await screen.findByText('负责人：成员一')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/projects\/project-1\/tasks$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: '分配负责人任务',
          description: '',
          priority: 'medium',
          assigneeId: assignee.id,
        }),
      }),
    );
  });

  it('generates editable AI task drafts and appends confirmed tasks to todo', async () => {
    const generatedDraft = {
      title: '梳理接口边界',
      description: '输出接口清单',
      priority: 'high' as const,
    };
    const confirmedTask = {
      ...createTask('task-ai-1', generatedDraft.title, 'todo'),
      description: generatedDraft.description,
      priority: generatedDraft.priority,
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith('/api/projects/project-1/ai/task-drafts') &&
          init?.method === 'POST'
        ) {
          return new Response(JSON.stringify([generatedDraft]), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (
          url.endsWith('/api/projects/project-1/tasks/batch') &&
          init?.method === 'POST'
        ) {
          return new Response(JSON.stringify([confirmedTask]), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.endsWith('/api/teams/team-1/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(createBoard()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByRole('heading', { name: '任务协作平台' });
    await user.type(
      screen.getByLabelText('项目目标'),
      '完成团队协作工作区的接口设计与联调',
    );
    await user.click(screen.getByRole('button', { name: '生成任务草稿' }));

    const draftTitleInput = await screen.findByDisplayValue('梳理接口边界');
    expect(draftTitleInput).toBeInTheDocument();
    await user.clear(draftTitleInput);
    await user.type(draftTitleInput, '完善接口边界');
    await user.click(screen.getByRole('button', { name: '确认创建任务' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/projects\/project-1\/tasks\/batch$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            tasks: [{ ...generatedDraft, title: '完善接口边界' }],
          }),
        }),
      );
    });
    expect(
      await within(screen.getByRole('tabpanel', { name: /待办/ })).findByText(
        '梳理接口边界',
      ),
    ).toBeInTheDocument();
  });

  it('shows an archive action only for completed active tasks', async () => {
    const todoTask = createTask('task-archive-todo', '尚未完成的任务', 'todo');
    const doneTask = createTask('task-archive-done', '可以归档的任务', 'done');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(createBoard({ todo: [todoTask], done: [doneTask] })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('尚未完成的任务');
    expect(
      screen.queryByRole('button', { name: '归档任务：尚未完成的任务' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '已完成 1' }));

    expect(
      screen.getByRole('button', { name: '归档任务：可以归档的任务' }),
    ).toBeInTheDocument();
  });

  it('does not send an archive request when confirmation is cancelled', async () => {
    const doneTask = createTask('task-archive-cancel', '取消归档的任务', 'done');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(createBoard({ done: [doneTask] })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => false));
    const user = userEvent.setup();

    renderBoard();
    await screen.findByRole('tab', { name: '已完成 1' });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    await user.click(
      screen.getByRole('button', { name: '归档任务：取消归档的任务' }),
    );

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith('/api/tasks/task-archive-cancel/archive') &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('removes a completed task from the active board after archiving succeeds', async () => {
    const doneTask = createTask('task-archive-success', '归档成功的任务', 'done');
    const archivedTask = {
      ...doneTask,
      archivedAt: '2026-08-11T10:00:00.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (
        String(input).endsWith('/api/tasks/task-archive-success/archive') &&
        init?.method === 'PATCH'
      ) {
        return new Response(JSON.stringify(archivedTask), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(createBoard({ done: [doneTask] })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const user = userEvent.setup();

    renderBoard();
    await screen.findByRole('tab', { name: '已完成 1' });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    await user.click(
      screen.getByRole('button', { name: '归档任务：归档成功的任务' }),
    );

    await waitFor(() => {
      expect(screen.queryByText('归档成功的任务')).not.toBeInTheDocument();
    });
  });

  it('keeps the task visible and shows the API message when archiving fails', async () => {
    const doneTask = createTask('task-archive-failure', '归档失败的任务', 'done');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (
        String(input).endsWith('/api/tasks/task-archive-failure/archive') &&
        init?.method === 'PATCH'
      ) {
        return new Response(JSON.stringify({ message: '任务暂时无法归档' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(createBoard({ done: [doneTask] })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const user = userEvent.setup();

    renderBoard();
    await screen.findByRole('tab', { name: '已完成 1' });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    await user.click(
      screen.getByRole('button', { name: '归档任务：归档失败的任务' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('任务暂时无法归档');
    expect(screen.getByText('归档失败的任务')).toBeInTheDocument();
  });

  it('requests archived tasks from the URL view, restores one, and reloads active done tasks', async () => {
    const archivedTask = {
      ...createTask('task-restore', '需要恢复的任务', 'done'),
      archivedAt: '2026-08-10T10:00:00.000Z',
    };
    const restoredTask = { ...archivedTask, archivedAt: null };
    const activeBoard = createBoard({ done: [restoredTask] });
    const archivedBoard = createBoard({ done: [archivedTask] });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/tasks/task-restore/archive') && init?.method === 'PATCH') {
        return new Response(JSON.stringify(restoredTask), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const response = new URL(url).searchParams.get('view') === 'archived'
        ? archivedBoard
        : activeBoard;
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard('/projects/project-1/board?view=archived');

    await screen.findByRole('tab', { name: '已完成 1' });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    expect(
      fetchMock.mock.calls.some(([input]) =>
        new URL(String(input)).searchParams.get('view') === 'archived',
      ),
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: '恢复任务：需要恢复的任务' }));
    await waitFor(() => {
      expect(screen.queryByText('需要恢复的任务')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '查看进行中的任务' }));
    await waitFor(() => {
      expect(screen.getByTestId('board-location')).toHaveTextContent('/projects/project-1/board');
      expect(screen.getByRole('tab', { name: '已完成 1' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    expect(await screen.findByText('需要恢复的任务')).toBeInTheDocument();
  });

  it('renders known activity records in Chinese and uses a readable fallback without JSON details', async () => {
    const activities = [
      createActivity('activity-created', 'created', '制定回归计划'),
      createActivity(
        'activity-unknown',
        'future_event',
        '未知活动任务',
        { internalCode: 'do-not-render' },
      ),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/projects/project-1/task-activities')) {
        return new Response(JSON.stringify(activities), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(createBoard()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoard();

    expect(await screen.findByText('王小明 创建了任务《制定回归计划》')).toBeInTheDocument();
    expect(screen.getByText('更新了任务《未知活动任务》')).toBeInTheDocument();
    expect(screen.queryByText(/internalCode/)).not.toBeInTheDocument();
  });

  it('keeps the board usable after an activity failure and retries only activities', async () => {
    const board = createBoard({ todo: [createTask('task-activity-retry', '活动失败仍可操作', 'todo')] });
    let boardRequests = 0;
    let activityRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/projects/project-1/task-activities')) {
        activityRequests += 1;
        return new Response(JSON.stringify({ message: '活动加载失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/teams/team-1/members')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      boardRequests += 1;
      return new Response(JSON.stringify(board), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    expect(await screen.findByText('活动失败仍可操作')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('活动加载失败');
    expect(boardRequests).toBe(1);
    expect(activityRequests).toBe(1);

    await user.click(screen.getByRole('button', { name: '重新加载活动' }));

    await waitFor(() => {
      expect(activityRequests).toBe(2);
    });
    expect(boardRequests).toBe(1);
    expect(screen.getByText('活动失败仍可操作')).toBeInTheDocument();
  });

  it('keeps a successful task status update when its activity refresh fails', async () => {
    const task = createTask('task-activity-refresh', '活动刷新失败不回滚', 'todo');
    const movedTask = { ...task, status: 'in_progress' as const };
    let activityRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/projects/project-1/task-activities')) {
        activityRequests += 1;
        if (activityRequests === 1) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ message: '活动刷新失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/tasks/task-activity-refresh/status') && init?.method === 'PATCH') {
        return new Response(JSON.stringify(movedTask), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(createBoard({ todo: [task] })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText('活动刷新失败不回滚');
    await waitFor(() => {
      expect(activityRequests).toBe(1);
    });

    await user.click(
      screen.getByRole('button', { name: '移动“活动刷新失败不回滚”到进行中' }),
    );
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '进行中 1' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: '进行中 1' }));

    expect(await screen.findByText('活动刷新失败不回滚')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('活动刷新失败');
  });
});
