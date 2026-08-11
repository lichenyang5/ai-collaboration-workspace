import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
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
  context: Partial<Pick<TaskBoardResponse, 'projectId' | 'projectName' | 'teamId'>> = {},
): TaskBoardResponse {
  return {
    projectId: 'project-1',
    projectName: '任务协作平台',
    teamId: 'team-1',
    ...context,
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

function ProjectNavigationProbe() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/projects/project-1/board')}>
        切换到项目一
      </button>
      <button
        type="button"
        onClick={() => navigate('/projects/project-1/board?q=foo')}
      >
        切换到项目一关键词
      </button>
      <button type="button" onClick={() => navigate('/projects/project-2/board')}>
        切换到项目二
      </button>
    </>
  );
}

function renderBoard(entry = '/projects/project-1/board') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/projects/:projectId/board" element={<TaskBoardPage />} />
      </Routes>
      <LocationProbe />
      <ProjectNavigationProbe />
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

  it('hides a mismatched query snapshot while filtering is pending or failed and shows only the retried result', async () => {
    const oldTask = createTask('task-old-filter', '旧筛选任务', 'todo');
    const filteredTask = {
      ...createTask('task-filtered-result', '高优先级筛选结果', 'todo'),
      priority: 'high' as const,
    };
    const filteredResponse = createDeferred<Response>();
    const initialBoard = createBoard({
      todo: [oldTask],
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
            return filteredResponse.promise;
          }
          if (boardRequestCount === 3) {
            return new Response(
              JSON.stringify(createBoard({ todo: [filteredTask] })),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
        }

        return new Response(JSON.stringify(initialBoard), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText(oldTask.title);
    await user.selectOptions(screen.getByLabelText('筛选优先级'), 'high');

    await waitFor(() => {
      expect(boardRequestCount).toBe(2);
    });

    try {
      expect(screen.queryByText(oldTask.title)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: `移动“${oldTask.title}”到进行中` }),
      ).not.toBeInTheDocument();

      await act(async () => {
        filteredResponse.resolve(
          new Response(JSON.stringify({ message: '筛选加载失败' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
        await Promise.resolve();
      });

      expect(await screen.findByRole('alert')).toHaveTextContent('筛选加载失败');
      expect(screen.queryByText(oldTask.title)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '重新加载' }));

      await waitFor(() => {
        expect(boardRequestCount).toBe(3);
      });
      expect(await screen.findByText(filteredTask.title)).toBeInTheDocument();
      expect(screen.queryByText(oldTask.title)).not.toBeInTheDocument();
    } finally {
      filteredResponse.resolve(
        new Response(JSON.stringify({ message: '筛选加载失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
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

  it('reloads the current filter after a mutation succeeds against a different query snapshot', async () => {
    const originalTask = createTask('task-stale-board', '旧中优先级任务', 'todo');
    const movedTask = { ...originalTask, status: 'in_progress' as const };
    const highPriorityTask = {
      ...createTask('task-current-filter', '当前高优先级任务', 'todo'),
      priority: 'high' as const,
    };
    const obsoleteHighPriorityTask = {
      ...createTask('task-obsolete-filter', '已废弃高优先级响应', 'todo'),
      priority: 'high' as const,
    };
    const mutationResponse = createDeferred<Response>();
    const obsoleteBoardResponse = createDeferred<Response>();
    let boardRequestCount = 0;
    let mutationRequestCount = 0;
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
          mutationRequestCount += 1;
          return mutationResponse.promise;
        }

        if (url.includes('/api/projects/project-1/tasks')) {
          boardRequestCount += 1;
          if (boardRequestCount === 2) {
            return obsoleteBoardResponse.promise;
          }
          if (boardRequestCount === 3) {
            return new Response(
              JSON.stringify(createBoard({ todo: [highPriorityTask] })),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
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
    await screen.findByText('旧中优先级任务');
    await user.click(
      screen.getByRole('button', { name: '移动“旧中优先级任务”到进行中' }),
    );
    expect(mutationRequestCount).toBe(1);

    fireEvent.change(screen.getByLabelText('筛选优先级'), {
      target: { value: 'high' },
    });
    await waitFor(() => {
      expect(boardRequestCount).toBe(2);
    });
    expect(screen.queryByText('旧中优先级任务')).not.toBeInTheDocument();

    await act(async () => {
      mutationResponse.resolve(
        new Response(JSON.stringify(movedTask), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(boardRequestCount).toBe(3);
    });
    expect(await screen.findByText('当前高优先级任务')).toBeInTheDocument();
    expect(screen.queryByText('旧中优先级任务')).not.toBeInTheDocument();

    await act(async () => {
      obsoleteBoardResponse.resolve(
        new Response(
          JSON.stringify(createBoard({ todo: [obsoleteHighPriorityTask] })),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      await Promise.resolve();
    });

    expect(screen.getByText('当前高优先级任务')).toBeInTheDocument();
    expect(screen.queryByText('已废弃高优先级响应')).not.toBeInTheDocument();
  });

  it('reloads a priority-filtered board after create instead of locally adding a nonmatching task', async () => {
    const existingTask = {
      ...createTask('task-filtered-create-existing', '现有高优先级任务', 'todo'),
      priority: 'high' as const,
    };
    const createdTask = createTask(
      'task-filtered-create-medium',
      '不应留在高优先级筛选中的任务',
      'todo',
    );
    let boardRequests = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/task-activities') || url.pathname.endsWith('/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname === '/api/projects/project-1/tasks' && init?.method === 'POST') {
          return new Response(JSON.stringify(createdTask), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname === '/api/projects/project-1/tasks') {
          boardRequests += 1;
          expect(url.searchParams.get('priority')).toBe('high');
          return new Response(
            JSON.stringify(createBoard({ todo: [existingTask] })),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard('/projects/project-1/board?priority=high');
    await screen.findByText(existingTask.title);
    await user.type(screen.getByLabelText('任务标题'), createdTask.title);
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => {
      expect(boardRequests).toBe(2);
    });
    expect(screen.getByText(existingTask.title)).toBeInTheDocument();
    expect(screen.queryByText(createdTask.title)).not.toBeInTheDocument();
  });

  it('reloads a keyword-filtered board after edit instead of keeping the renamed nonmatching task', async () => {
    const originalTask = createTask(
      'task-filtered-edit',
      'keep 原始标题',
      'todo',
    );
    const updatedTask = {
      ...originalTask,
      title: '已移出关键词结果',
    };
    const remainingTask = createTask(
      'task-filtered-edit-remaining',
      'keep 保留结果',
      'todo',
    );
    let boardRequests = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/tasks/task-filtered-edit' && init?.method === 'PATCH') {
          return new Response(JSON.stringify(updatedTask), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname.endsWith('/task-activities') || url.pathname.endsWith('/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname === '/api/projects/project-1/tasks') {
          boardRequests += 1;
          expect(url.searchParams.get('q')).toBe('keep');
          return new Response(
            JSON.stringify(
              createBoard({
                todo: [boardRequests === 1 ? originalTask : remainingTask],
              }),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard('/projects/project-1/board?q=keep');
    await screen.findByText(originalTask.title);
    await user.click(
      screen.getByRole('button', { name: `编辑详情：${originalTask.title}` }),
    );
    const titleInput = screen.getByLabelText('编辑任务标题');
    await user.clear(titleInput);
    await user.type(titleInput, updatedTask.title);
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(boardRequests).toBe(2);
    });
    expect(await screen.findByText(remainingTask.title)).toBeInTheDocument();
    expect(screen.queryByText(updatedTask.title)).not.toBeInTheDocument();
  });

  it('reloads a keyword-filtered board after archive instead of treating a local removal as authoritative', async () => {
    const archivedTask = createTask(
      'task-filtered-archive',
      'keep 待归档任务',
      'done',
    );
    const remainingTask = createTask(
      'task-filtered-archive-remaining',
      'keep 服务端保留任务',
      'done',
    );
    let boardRequests = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/tasks/task-filtered-archive/archive' && init?.method === 'PATCH') {
          return new Response(
            JSON.stringify({ ...archivedTask, archivedAt: createdAt }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.pathname.endsWith('/task-activities') || url.pathname.endsWith('/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname === '/api/projects/project-1/tasks') {
          boardRequests += 1;
          expect(url.searchParams.get('q')).toBe('keep');
          return new Response(
            JSON.stringify(
              createBoard({
                done: [boardRequests === 1 ? archivedTask : remainingTask],
              }),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const user = userEvent.setup();

    renderBoard('/projects/project-1/board?q=keep');
    await user.click(await screen.findByRole('tab', { name: '已完成 1' }));
    await user.click(
      screen.getByRole('button', { name: `归档任务：${archivedTask.title}` }),
    );

    await waitFor(() => {
      expect(boardRequests).toBe(2);
    });
    expect(await screen.findByText(remainingTask.title)).toBeInTheDocument();
    expect(screen.queryByText(archivedTask.title)).not.toBeInTheDocument();
  });

  it('reloads the current board when a mutation spans a project ABA hidden by keyword debounce', async () => {
    const originalTask = createTask('task-debounce-aba', 'ABA 前任务', 'todo');
    const movedTask = { ...originalTask, status: 'in_progress' as const };
    const freshTask = createTask('task-debounce-fresh', 'ABA 后最新任务', 'todo');
    const obsoleteTask = createTask('task-debounce-obsolete', 'ABA 旧请求任务', 'todo');
    const mutationResponse = createDeferred<Response>();
    const obsoleteBoardResponse = createDeferred<Response>();
    let projectOneBoardRequests = 0;
    let projectTwoBoardRequests = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (
          url.pathname === '/api/tasks/task-debounce-aba/status' &&
          init?.method === 'PATCH'
        ) {
          return mutationResponse.promise;
        }
        if (url.pathname.endsWith('/task-activities') || url.pathname.endsWith('/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname === '/api/projects/project-2/tasks') {
          projectTwoBoardRequests += 1;
          return new Response(
            JSON.stringify(
              createBoard({}, {
                projectId: 'project-2',
                projectName: '项目二',
                teamId: 'team-2',
              }),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.pathname === '/api/projects/project-1/tasks') {
          projectOneBoardRequests += 1;
          if (projectOneBoardRequests === 2) {
            return obsoleteBoardResponse.promise;
          }
          return new Response(
            JSON.stringify(
              createBoard({
                todo: [projectOneBoardRequests === 1 ? originalTask : freshTask],
              }),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderBoard('/projects/project-1/board?q=foo');
    await screen.findByText(originalTask.title);
    vi.useFakeTimers();

    fireEvent.click(
      screen.getByRole('button', { name: `移动“${originalTask.title}”到进行中` }),
    );
    fireEvent.click(screen.getByRole('button', { name: '切换到项目二' }));
    fireEvent.click(screen.getByRole('button', { name: '切换到项目一关键词' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(projectTwoBoardRequests).toBe(0);
    expect(projectOneBoardRequests).toBe(2);

    await act(async () => {
      mutationResponse.resolve(
        new Response(JSON.stringify(movedTask), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    expect(projectOneBoardRequests).toBe(3);
    expect(screen.getByText(freshTask.title)).toBeInTheDocument();
    expect(screen.queryByText(originalTask.title)).not.toBeInTheDocument();

    await act(async () => {
      obsoleteBoardResponse.resolve(
        new Response(JSON.stringify(createBoard({ todo: [obsoleteTask] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText(freshTask.title)).toBeInTheDocument();
    expect(screen.queryByText(obsoleteTask.title)).not.toBeInTheDocument();
  });

  it('clears the previous project board, editor, members, and activities while the next project is pending and after it fails', async () => {
    const oldTask = createTask('task-old-project', '项目一旧任务', 'todo');
    const oldMember = {
      id: '11111111-1111-4111-8111-111111111111',
      displayName: '项目一成员',
      email: 'project-one@example.com',
      role: 'member' as const,
    };
    const nextBoardResponse = createDeferred<Response>();
    const nextActivitiesResponse = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/projects/project-2/tasks') {
        return nextBoardResponse.promise;
      }
      if (url.pathname === '/api/projects/project-2/task-activities') {
        return nextActivitiesResponse.promise;
      }
      if (url.pathname === '/api/projects/project-1/task-activities') {
        return new Response(
          JSON.stringify([createActivity('old-project', 'created', '项目一活动任务')]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.pathname === '/api/teams/team-1/members') {
        return new Response(JSON.stringify([oldMember]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.pathname === '/api/projects/project-1/tasks') {
        return new Response(JSON.stringify(createBoard({ todo: [oldTask] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText(oldTask.title);
    expect(
      await screen.findByText('王小明 创建了任务《项目一活动任务》'),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByRole('combobox', { name: '负责人' })).findByRole(
        'option',
        { name: oldMember.displayName },
      ),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: `编辑详情：${oldTask.title}` }),
    );

    await user.click(screen.getByRole('button', { name: '切换到项目二' }));
    await waitFor(() => {
      expect(screen.getByTestId('board-location')).toHaveTextContent(
        '/projects/project-2/board',
      );
    });

    try {
      expect(screen.queryByText(oldTask.title)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: `移动“${oldTask.title}”到进行中` }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(`编辑“${oldTask.title}”`)).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: oldMember.displayName })).not.toBeInTheDocument();
      expect(
        screen.queryByText('王小明 创建了任务《项目一活动任务》'),
      ).not.toBeInTheDocument();

      await act(async () => {
        nextBoardResponse.resolve(
          new Response(JSON.stringify({ message: '项目二看板加载失败' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
        nextActivitiesResponse.resolve(
          new Response(JSON.stringify({ message: '项目二活动加载失败' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
        await Promise.resolve();
      });

      expect(await screen.findByText('项目二看板加载失败')).toBeInTheDocument();
      expect(screen.queryByText(oldTask.title)).not.toBeInTheDocument();
      expect(
        screen.queryByText('王小明 创建了任务《项目一活动任务》'),
      ).not.toBeInTheDocument();
    } finally {
      nextBoardResponse.resolve(
        new Response(JSON.stringify({ message: '项目二看板加载失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      nextActivitiesResponse.resolve(
        new Response(JSON.stringify({ message: '项目二活动加载失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
  });

  it('does not reconcile a completed mutation from the previous project into the current project board', async () => {
    const sharedTaskId = 'task-shared-between-projects';
    const projectOneTask = createTask(sharedTaskId, '项目一任务', 'todo');
    const movedProjectOneTask = {
      ...projectOneTask,
      status: 'in_progress' as const,
    };
    const projectTwoTask = createTask(sharedTaskId, '项目二同标识任务', 'todo');
    const statusResponse = createDeferred<Response>();
    let projectTwoBoardRequests = 0;
    let projectTwoActivityRequests = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (
          url.pathname === `/api/tasks/${sharedTaskId}/status` &&
          init?.method === 'PATCH'
        ) {
          return statusResponse.promise;
        }
        if (url.pathname === '/api/projects/project-2/task-activities') {
          projectTwoActivityRequests += 1;
          return new Response(
            JSON.stringify(
              projectTwoActivityRequests === 1
                ? []
                : { message: '不应刷新的项目二活动失败' },
            ),
            {
              status: projectTwoActivityRequests === 1 ? 200 : 500,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (url.pathname === '/api/projects/project-1/task-activities') {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname === '/api/teams/team-1/members' || url.pathname === '/api/teams/team-2/members') {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname === '/api/projects/project-2/tasks') {
          projectTwoBoardRequests += 1;
          return new Response(
            JSON.stringify(
              createBoard(
                { todo: [projectTwoTask] },
                {
                  projectId: 'project-2',
                  projectName: '项目二',
                  teamId: 'team-2',
                },
              ),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.pathname === '/api/projects/project-1/tasks') {
          return new Response(
            JSON.stringify(createBoard({ todo: [projectOneTask] })),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText(projectOneTask.title);
    await user.click(
      screen.getByRole('button', {
        name: `移动“${projectOneTask.title}”到进行中`,
      }),
    );
    await user.click(screen.getByRole('button', { name: '切换到项目二' }));
    expect(await screen.findByText(projectTwoTask.title)).toBeInTheDocument();

    await act(async () => {
      statusResponse.resolve(
        new Response(JSON.stringify(movedProjectOneTask), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(projectTwoBoardRequests).toBe(2);
    });
    expect(projectTwoActivityRequests).toBe(1);
    expect(screen.queryByText('不应刷新的项目二活动失败')).not.toBeInTheDocument();
    expect(screen.getByText(projectTwoTask.title)).toBeInTheDocument();
    expect(screen.queryByText(projectOneTask.title)).not.toBeInTheDocument();
  });

  it('keeps the current create form independent from an old create across a project ABA transition', async () => {
    const oldCreateResponse = createDeferred<Response>();
    const oldCreatedTask = createTask('task-old-create', '旧项目创建任务', 'todo');
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (
          url.pathname === '/api/projects/project-1/tasks' &&
          init?.method === 'POST'
        ) {
          return oldCreateResponse.promise;
        }
        if (url.pathname.endsWith('/task-activities')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname.endsWith('/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname.endsWith('/tasks')) {
          const nextProjectId = url.pathname.includes('project-2')
            ? 'project-2'
            : 'project-1';
          return new Response(
            JSON.stringify(
              createBoard({}, {
                projectId: nextProjectId,
                projectName: nextProjectId === 'project-2' ? '项目二' : '项目一',
                teamId: nextProjectId === 'project-2' ? 'team-2' : 'team-1',
              }),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByRole('heading', { name: '项目一' });
    await user.type(screen.getByLabelText('任务标题'), '旧项目创建任务');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    await user.click(screen.getByRole('button', { name: '切换到项目二' }));
    expect(await screen.findByRole('heading', { name: '项目二' })).toBeInTheDocument();
    expect(screen.getByLabelText('任务标题')).toHaveValue('');
    expect(screen.getByRole('button', { name: '创建任务' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '切换到项目一' }));
    expect(await screen.findByRole('heading', { name: '项目一' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('任务标题'), '当前项目一新输入');

    await act(async () => {
      oldCreateResponse.resolve(
        new Response(JSON.stringify(oldCreatedTask), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByLabelText('任务标题')).toHaveValue('当前项目一新输入');
    expect(screen.getByRole('button', { name: '创建任务' })).toBeEnabled();
  });

  it('keeps a new project editor active when an old project edit fails after an ABA transition', async () => {
    const oldTask = createTask('task-old-edit', '旧项目编辑任务', 'todo');
    const currentTask = createTask('task-current-edit', '当前项目编辑任务', 'todo');
    const oldEditResponse = createDeferred<Response>();
    let projectOneBoardRequests = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/tasks/task-old-edit' && init?.method === 'PATCH') {
          return oldEditResponse.promise;
        }
        if (url.pathname.endsWith('/task-activities') || url.pathname.endsWith('/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname === '/api/projects/project-1/tasks') {
          projectOneBoardRequests += 1;
          return new Response(
            JSON.stringify(
              createBoard({
                todo: [projectOneBoardRequests === 1 ? oldTask : currentTask],
              }),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.pathname === '/api/projects/project-2/tasks') {
          return new Response(
            JSON.stringify(
              createBoard({}, {
                projectId: 'project-2',
                projectName: '项目二',
                teamId: 'team-2',
              }),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText(oldTask.title);
    await user.click(
      screen.getByRole('button', { name: `编辑详情：${oldTask.title}` }),
    );
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    await user.click(screen.getByRole('button', { name: '切换到项目二' }));
    await screen.findByRole('heading', { name: '项目二' });
    await user.click(screen.getByRole('button', { name: '切换到项目一' }));

    expect(await screen.findByText(currentTask.title)).toBeInTheDocument();
    expect(screen.queryByText(`编辑“${oldTask.title}”`)).not.toBeInTheDocument();
    const currentEditButton = screen.getByRole('button', {
      name: `编辑详情：${currentTask.title}`,
    });
    expect(currentEditButton).toBeEnabled();
    await user.click(currentEditButton);
    expect(screen.getByText(`编辑“${currentTask.title}”`)).toBeInTheDocument();

    await act(async () => {
      oldEditResponse.resolve(
        new Response(JSON.stringify({ message: '旧项目编辑失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText(`编辑“${currentTask.title}”`)).toBeInTheDocument();
    expect(screen.queryByText('旧项目编辑失败')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存修改' })).toBeEnabled();
  });

  it('keeps current AI generation state and drafts isolated from an old project generation', async () => {
    const oldAiResponse = createDeferred<Response>();
    const currentAiResponse = createDeferred<Response>();
    const oldDraft = {
      title: '旧项目 AI 草稿',
      description: '',
      priority: 'medium' as const,
    };
    const currentDraft = {
      title: '当前项目 AI 草稿',
      description: '',
      priority: 'high' as const,
    };
    let aiRequestCount = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/ai/task-drafts') && init?.method === 'POST') {
          aiRequestCount += 1;
          return aiRequestCount === 1 ? oldAiResponse.promise : currentAiResponse.promise;
        }
        if (url.pathname.endsWith('/task-activities') || url.pathname.endsWith('/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname.endsWith('/tasks')) {
          const isProjectTwo = url.pathname.includes('project-2');
          return new Response(
            JSON.stringify(
              createBoard({}, {
                projectId: isProjectTwo ? 'project-2' : 'project-1',
                projectName: isProjectTwo ? '项目二' : '项目一',
                teamId: isProjectTwo ? 'team-2' : 'team-1',
              }),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByRole('heading', { name: '项目一' });
    await user.type(screen.getByLabelText('项目目标'), '旧项目需要生成一组任务草稿');
    await user.click(screen.getByRole('button', { name: '生成任务草稿' }));
    await user.click(screen.getByRole('button', { name: '切换到项目二' }));

    await screen.findByRole('heading', { name: '项目二' });
    expect(screen.getByLabelText('项目目标')).toHaveValue('');
    expect(screen.getByRole('button', { name: '生成任务草稿' })).toBeEnabled();
    await user.type(screen.getByLabelText('项目目标'), '当前项目需要生成新的任务草稿');
    await user.click(screen.getByRole('button', { name: '生成任务草稿' }));

    try {
      await act(async () => {
        oldAiResponse.resolve(
          new Response(JSON.stringify([oldDraft]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
        await Promise.resolve();
      });

      expect(screen.getByRole('button', { name: '生成中…' })).toBeDisabled();
      expect(screen.queryByDisplayValue(oldDraft.title)).not.toBeInTheDocument();
      expect(screen.getByLabelText('项目目标')).toHaveValue(
        '当前项目需要生成新的任务草稿',
      );

      await act(async () => {
        currentAiResponse.resolve(
          new Response(JSON.stringify([currentDraft]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
        await Promise.resolve();
      });
      expect(await screen.findByDisplayValue(currentDraft.title)).toBeInTheDocument();
    } finally {
      oldAiResponse.resolve(
        new Response(JSON.stringify([oldDraft]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      currentAiResponse.resolve(
        new Response(JSON.stringify([currentDraft]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
  });

  it('does not carry old move and archive busy or error state into another project', async () => {
    const oldMoveTask = createTask('task-shared-move', '项目一移动任务', 'todo');
    const currentMoveTask = createTask('task-shared-move', '项目二移动任务', 'todo');
    const oldArchiveTask = createTask('task-shared-archive', '项目一归档任务', 'done');
    const currentArchiveTask = createTask('task-shared-archive', '项目二归档任务', 'done');
    const moveResponse = createDeferred<Response>();
    const archiveResponse = createDeferred<Response>();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/tasks/task-shared-move/status' && init?.method === 'PATCH') {
          return moveResponse.promise;
        }
        if (url.pathname === '/api/tasks/task-shared-archive/archive' && init?.method === 'PATCH') {
          return archiveResponse.promise;
        }
        if (url.pathname.endsWith('/task-activities') || url.pathname.endsWith('/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.pathname === '/api/projects/project-2/tasks') {
          return new Response(
            JSON.stringify(
              createBoard(
                { todo: [currentMoveTask], done: [currentArchiveTask] },
                { projectId: 'project-2', projectName: '项目二', teamId: 'team-2' },
              ),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.pathname === '/api/projects/project-1/tasks') {
          return new Response(
            JSON.stringify(createBoard({ todo: [oldMoveTask], done: [oldArchiveTask] })),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText(oldMoveTask.title);
    await user.click(
      screen.getByRole('button', { name: `移动“${oldMoveTask.title}”到进行中` }),
    );
    await user.click(screen.getByRole('button', { name: '切换到项目二' }));

    const currentMoveButton = await screen.findByRole('button', {
      name: `移动“${currentMoveTask.title}”到进行中`,
    });
    expect(currentMoveButton).toBeEnabled();
    await act(async () => {
      moveResponse.resolve(
        new Response(JSON.stringify({ message: '旧项目移动失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });
    expect(screen.queryByText('旧项目移动失败')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '切换到项目一' }));
    await user.click(await screen.findByRole('tab', { name: '已完成 1' }));
    await user.click(
      screen.getByRole('button', { name: `归档任务：${oldArchiveTask.title}` }),
    );
    await user.click(screen.getByRole('button', { name: '切换到项目二' }));
    const currentArchiveButton = await screen.findByRole('button', {
      name: `归档任务：${currentArchiveTask.title}`,
    });
    expect(currentArchiveButton).toBeEnabled();

    await act(async () => {
      archiveResponse.resolve(
        new Response(JSON.stringify({ message: '旧项目归档失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });
    expect(screen.queryByText('旧项目归档失败')).not.toBeInTheDocument();
  });

  it('serializes same-project moves and unlocks all move actions after the active request fails', async () => {
    const firstTask = createTask('task-concurrent-move-a', '并发移动任务 A', 'todo');
    const secondTask = createTask('task-concurrent-move-b', '并发移动任务 B', 'todo');
    const firstMoveResponse = createDeferred<Response>();
    const secondMoveResponse = createDeferred<Response>();
    const movedSecondTask = { ...secondTask, status: 'in_progress' as const };
    let firstMoveRequests = 0;
    let secondMoveRequests = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/tasks/task-concurrent-move-a/status' && init?.method === 'PATCH') {
          firstMoveRequests += 1;
          return firstMoveResponse.promise;
        }
        if (url.pathname === '/api/tasks/task-concurrent-move-b/status' && init?.method === 'PATCH') {
          secondMoveRequests += 1;
          return secondMoveResponse.promise;
        }
        if (url.pathname.endsWith('/task-activities') || url.pathname.endsWith('/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify(createBoard({ todo: [firstTask, secondTask] })),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText(firstTask.title);
    const firstMoveButton = screen.getByRole('button', {
      name: `移动“${firstTask.title}”到进行中`,
    });
    const secondMoveButton = screen.getByRole('button', {
      name: `移动“${secondTask.title}”到进行中`,
    });
    await user.click(firstMoveButton);

    expect(firstMoveRequests).toBe(1);
    expect(firstMoveButton).toBeDisabled();
    expect(secondMoveButton).toBeDisabled();
    await user.click(secondMoveButton);
    expect(secondMoveRequests).toBe(0);

    await act(async () => {
      firstMoveResponse.resolve(
        new Response(JSON.stringify({ message: '较早移动失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('较早移动失败');
    expect(firstMoveButton).toBeEnabled();
    expect(secondMoveButton).toBeEnabled();

    await user.click(secondMoveButton);
    expect(secondMoveRequests).toBe(1);
    expect(secondMoveButton).toBeDisabled();

    await act(async () => {
      secondMoveResponse.resolve(
        new Response(JSON.stringify(movedSecondTask), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    await user.click(screen.getByRole('tab', { name: '进行中 1' }));
    expect(screen.getByText(secondTask.title)).toBeInTheDocument();
  });

  it('serializes same-project archives and unlocks the next archive after the active request succeeds', async () => {
    const firstTask = createTask('task-concurrent-archive-a', '并发归档任务 A', 'done');
    const secondTask = createTask('task-concurrent-archive-b', '并发归档任务 B', 'done');
    const firstArchiveResponse = createDeferred<Response>();
    const secondArchiveResponse = createDeferred<Response>();
    let firstArchiveRequests = 0;
    let secondArchiveRequests = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/tasks/task-concurrent-archive-a/archive' && init?.method === 'PATCH') {
          firstArchiveRequests += 1;
          return firstArchiveResponse.promise;
        }
        if (url.pathname === '/api/tasks/task-concurrent-archive-b/archive' && init?.method === 'PATCH') {
          secondArchiveRequests += 1;
          return secondArchiveResponse.promise;
        }
        if (url.pathname.endsWith('/task-activities') || url.pathname.endsWith('/members')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify(createBoard({ done: [firstTask, secondTask] })),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const user = userEvent.setup();

    renderBoard();
    await user.click(await screen.findByRole('tab', { name: '已完成 2' }));
    const firstArchiveButton = screen.getByRole('button', {
      name: `归档任务：${firstTask.title}`,
    });
    const secondArchiveButton = screen.getByRole('button', {
      name: `归档任务：${secondTask.title}`,
    });
    await user.click(firstArchiveButton);

    expect(firstArchiveRequests).toBe(1);
    expect(firstArchiveButton).toBeDisabled();
    expect(secondArchiveButton).toBeDisabled();
    await user.click(secondArchiveButton);
    expect(secondArchiveRequests).toBe(0);

    await act(async () => {
      firstArchiveResponse.resolve(
        new Response(JSON.stringify({ ...firstTask, archivedAt: createdAt }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    expect(screen.queryByText(firstTask.title)).not.toBeInTheDocument();
    expect(secondArchiveButton).toBeEnabled();

    await user.click(secondArchiveButton);
    expect(secondArchiveRequests).toBe(1);
    expect(secondArchiveButton).toBeDisabled();

    await act(async () => {
      secondArchiveResponse.resolve(
        new Response(JSON.stringify({ message: '当前归档失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('当前归档失败');
    expect(secondArchiveButton).toBeEnabled();
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

  it('does not render an active-board snapshot with restore controls while archived loading is pending or fails', async () => {
    const activeTask = createTask('task-active-snapshot', '旧进行中任务', 'done');
    const archivedLoad = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/projects/project-1/task-activities') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/teams/team-1/members') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/projects/project-1/tasks' && url.searchParams.get('view') === 'archived') {
        return archivedLoad.promise;
      }
      return new Response(JSON.stringify(createBoard({ done: [activeTask] })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByRole('tab', { name: '已完成 1' });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    await user.click(screen.getByRole('button', { name: '查看已归档任务' }));

    await waitFor(() => {
      expect(screen.getByTestId('board-location')).toHaveTextContent('?view=archived');
    });
    expect(screen.queryByText('旧进行中任务')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢复任务：旧进行中任务' })).not.toBeInTheDocument();

    await act(async () => {
      archivedLoad.resolve(
        new Response(JSON.stringify({ message: '归档看板加载失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('归档看板加载失败');
    expect(screen.queryByText('旧进行中任务')).not.toBeInTheDocument();
  });

  it('does not render an archived snapshot with active-card controls while active loading is pending or fails', async () => {
    const archivedTask = {
      ...createTask('task-archived-snapshot', '旧归档任务', 'done'),
      archivedAt: '2026-08-10T10:00:00.000Z',
    };
    const activeLoad = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/projects/project-1/task-activities') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/teams/team-1/members') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/projects/project-1/tasks' && url.searchParams.get('view') !== 'archived') {
        return activeLoad.promise;
      }
      return new Response(JSON.stringify(createBoard({ done: [archivedTask] })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard('/projects/project-1/board?view=archived');
    await screen.findByRole('tab', { name: '已完成 1' });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    await user.click(screen.getByRole('button', { name: '查看进行中的任务' }));

    await waitFor(() => {
      expect(screen.getByTestId('board-location')).toHaveTextContent('/projects/project-1/board');
    });
    expect(screen.queryByText('旧归档任务')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑详情：旧归档任务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '归档任务：旧归档任务' })).not.toBeInTheDocument();

    await act(async () => {
      activeLoad.resolve(
        new Response(JSON.stringify({ message: '进行中看板加载失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('进行中看板加载失败');
    expect(screen.queryByText('旧归档任务')).not.toBeInTheDocument();
  });

  it('reloads the archived view after an archive completes during a view switch', async () => {
    const activeTask = createTask('task-archive-switch', '切换时归档的任务', 'done');
    const archivedTask = { ...activeTask, archivedAt: '2026-08-11T10:00:00.000Z' };
    const archivePatch = createDeferred<Response>();
    const staleArchivedLoad = createDeferred<Response>();
    let archivedTaskRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/projects/project-1/task-activities') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/teams/team-1/members') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/tasks/task-archive-switch/archive' && init?.method === 'PATCH') {
        return archivePatch.promise;
      }
      if (url.pathname === '/api/projects/project-1/tasks') {
        if (url.searchParams.get('view') === 'archived') {
          archivedTaskRequests += 1;
          if (archivedTaskRequests === 1) {
            return staleArchivedLoad.promise;
          }
          return new Response(JSON.stringify(createBoard({ done: [archivedTask] })), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(createBoard({ done: [activeTask] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const user = userEvent.setup();

    renderBoard();
    await screen.findByRole('tab', { name: '已完成 1' });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    await user.click(screen.getByRole('button', { name: '归档任务：切换时归档的任务' }));
    await user.click(screen.getByRole('button', { name: '查看已归档任务' }));
    await waitFor(() => {
      expect(archivedTaskRequests).toBe(1);
    });

    await act(async () => {
      archivePatch.resolve(new Response(JSON.stringify(archivedTask), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
      staleArchivedLoad.resolve(new Response(JSON.stringify(createBoard({ done: [archivedTask] })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(archivedTaskRequests).toBe(2);
    });
    expect(await screen.findByText('切换时归档的任务')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复任务：切换时归档的任务' })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input, init]) =>
        new URL(String(input)).pathname === '/api/tasks/task-archive-switch/archive' &&
        (init as RequestInit | undefined)?.method === 'PATCH' &&
        (init as RequestInit | undefined)?.body === JSON.stringify({ archived: true }),
      ),
    ).toBe(true);
  });

  it('reloads the active view after a restore completes during a view switch', async () => {
    const archivedTask = {
      ...createTask('task-restore-switch', '切换时恢复的任务', 'done'),
      archivedAt: '2026-08-10T10:00:00.000Z',
    };
    const restoredTask = { ...archivedTask, archivedAt: null };
    const restorePatch = createDeferred<Response>();
    const staleActiveLoad = createDeferred<Response>();
    let activeTaskRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/projects/project-1/task-activities') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/teams/team-1/members') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/tasks/task-restore-switch/archive' && init?.method === 'PATCH') {
        return restorePatch.promise;
      }
      if (url.pathname === '/api/projects/project-1/tasks') {
        if (url.searchParams.get('view') === 'archived') {
          return new Response(JSON.stringify(createBoard({ done: [archivedTask] })), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        activeTaskRequests += 1;
        if (activeTaskRequests === 1) {
          return staleActiveLoad.promise;
        }
        return new Response(JSON.stringify(createBoard({ done: [restoredTask] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard('/projects/project-1/board?view=archived');
    await screen.findByRole('tab', { name: '已完成 1' });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    await user.click(screen.getByRole('button', { name: '恢复任务：切换时恢复的任务' }));
    await user.click(screen.getByRole('button', { name: '查看进行中的任务' }));
    await waitFor(() => {
      expect(activeTaskRequests).toBe(1);
    });

    await act(async () => {
      restorePatch.resolve(new Response(JSON.stringify(restoredTask), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
      staleActiveLoad.resolve(new Response(JSON.stringify(createBoard({ done: [restoredTask] })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(activeTaskRequests).toBe(2);
    });
    expect(await screen.findByText('切换时恢复的任务')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '归档任务：切换时恢复的任务' })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input, init]) =>
        new URL(String(input)).pathname === '/api/tasks/task-restore-switch/archive' &&
        (init as RequestInit | undefined)?.method === 'PATCH' &&
        (init as RequestInit | undefined)?.body === JSON.stringify({ archived: false }),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        new URL(String(input)).pathname === '/api/projects/project-1/tasks' &&
        new URL(String(input)).searchParams.get('view') === 'archived',
      ),
    ).toBe(true);
  });

  it('hides active-only creation and AI controls in the archived view', async () => {
    const archivedTask = {
      ...createTask('task-archived-controls', '归档任务不应新增', 'done'),
      archivedAt: '2026-08-10T10:00:00.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/projects/project-1/task-activities') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/teams/team-1/members') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/projects/project-1/tasks' && init?.method === undefined) {
        return new Response(JSON.stringify(createBoard({ done: [archivedTask] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBoard('/projects/project-1/board?view=archived');

    await screen.findByRole('tab', { name: '已完成 1' });
    expect(screen.queryByLabelText('任务标题')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('项目目标')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          new URL(String(input)).pathname === '/api/projects/project-1/tasks' &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('reloads archived data after a pending active create succeeds and its activity refresh fails', async () => {
    const activeTask = createTask('task-create-source', '创建前的进行中任务', 'todo');
    const createdTask = createTask('task-created-switch', '切换时创建的进行中任务', 'todo');
    const archivedTask = {
      ...createTask('task-create-archived', '归档视图的任务', 'done'),
      archivedAt: '2026-08-10T10:00:00.000Z',
    };
    const createResponse = createDeferred<Response>();
    const staleArchivedLoad = createDeferred<Response>();
    let archivedTaskRequests = 0;
    let activityRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/projects/project-1/task-activities') {
        activityRequests += 1;
        return new Response(
          JSON.stringify(
            activityRequests === 1 ? [] : { message: '创建后的活动刷新失败' },
          ),
          {
            status: activityRequests === 1 ? 200 : 500,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      if (url.pathname === '/api/teams/team-1/members') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/projects/project-1/tasks' && init?.method === 'POST') {
        return createResponse.promise;
      }
      if (url.pathname === '/api/projects/project-1/tasks') {
        if (url.searchParams.get('view') === 'archived') {
          archivedTaskRequests += 1;
          if (archivedTaskRequests === 1) {
            return staleArchivedLoad.promise;
          }
          return new Response(JSON.stringify(createBoard({ done: [archivedTask] })), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(createBoard({ todo: [activeTask] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText('创建前的进行中任务');
    await user.type(screen.getByLabelText('任务标题'), createdTask.title);
    await user.click(screen.getByRole('button', { name: '创建任务' }));
    await user.click(screen.getByRole('button', { name: '查看已归档任务' }));
    await waitFor(() => {
      expect(archivedTaskRequests).toBe(1);
    });

    await act(async () => {
      createResponse.resolve(new Response(JSON.stringify(createdTask), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
      staleArchivedLoad.resolve(new Response(JSON.stringify(createBoard({ done: [archivedTask] })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(archivedTaskRequests).toBe(2);
      expect(activityRequests).toBe(2);
    });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    expect(await screen.findByText('归档视图的任务')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复任务：归档视图的任务' })).toBeInTheDocument();
    expect(screen.queryByText(createdTask.title)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `恢复任务：${createdTask.title}` }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('创建后的活动刷新失败');
  });

  it('reloads archived data after a pending active status update succeeds and its activity refresh fails', async () => {
    const sourceTask = createTask('task-status-source', '切换时更新状态的任务', 'todo');
    const movedTask = { ...sourceTask, status: 'in_progress' as const };
    const archivedTask = {
      ...createTask('task-status-archived', '状态更新后的归档任务', 'done'),
      archivedAt: '2026-08-10T10:00:00.000Z',
    };
    const statusResponse = createDeferred<Response>();
    const staleArchivedLoad = createDeferred<Response>();
    let archivedTaskRequests = 0;
    let activityRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/projects/project-1/task-activities') {
        activityRequests += 1;
        return new Response(
          JSON.stringify(
            activityRequests === 1 ? [] : { message: '状态更新后的活动刷新失败' },
          ),
          {
            status: activityRequests === 1 ? 200 : 500,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      if (url.pathname === '/api/teams/team-1/members') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/tasks/task-status-source/status' && init?.method === 'PATCH') {
        return statusResponse.promise;
      }
      if (url.pathname === '/api/projects/project-1/tasks') {
        if (url.searchParams.get('view') === 'archived') {
          archivedTaskRequests += 1;
          if (archivedTaskRequests === 1) {
            return staleArchivedLoad.promise;
          }
          return new Response(JSON.stringify(createBoard({ done: [archivedTask] })), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(createBoard({ todo: [sourceTask] })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText(sourceTask.title);
    await user.click(
      screen.getByRole('button', { name: `移动“${sourceTask.title}”到进行中` }),
    );
    await user.click(screen.getByRole('button', { name: '查看已归档任务' }));
    await waitFor(() => {
      expect(archivedTaskRequests).toBe(1);
    });

    await act(async () => {
      statusResponse.resolve(new Response(JSON.stringify(movedTask), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
      staleArchivedLoad.resolve(new Response(JSON.stringify(createBoard({ done: [archivedTask] })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(archivedTaskRequests).toBe(2);
      expect(activityRequests).toBe(2);
    });
    await user.click(screen.getByRole('tab', { name: '已完成 1' }));
    expect(await screen.findByText('状态更新后的归档任务')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复任务：状态更新后的归档任务' })).toBeInTheDocument();
    expect(screen.queryByText(sourceTask.title)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `恢复任务：${sourceTask.title}` }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('状态更新后的活动刷新失败');
  });

  it('reloads the current active context when an active create completes after an archived-view ABA transition', async () => {
    const sourceTask = createTask('task-aba-source', '创建前的活动任务', 'todo');
    const createdTask = createTask('task-aba-created', 'ABA 后创建的活动任务', 'todo');
    const archivedTask = {
      ...createTask('task-aba-archived', 'ABA 归档任务', 'done'),
      archivedAt: '2026-08-10T10:00:00.000Z',
    };
    const createResponse = createDeferred<Response>();
    const staleActiveLoad = createDeferred<Response>();
    let activeTaskRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/projects/project-1/task-activities') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/teams/team-1/members') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/api/projects/project-1/tasks' && init?.method === 'POST') {
        return createResponse.promise;
      }
      if (url.pathname === '/api/projects/project-1/tasks') {
        if (url.searchParams.get('view') === 'archived') {
          return new Response(JSON.stringify(createBoard({ done: [archivedTask] })), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        activeTaskRequests += 1;
        if (activeTaskRequests === 2) {
          return staleActiveLoad.promise;
        }
        return new Response(
          JSON.stringify(
            createBoard({ todo: activeTaskRequests === 1 ? [sourceTask] : [sourceTask, createdTask] }),
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText(sourceTask.title);
    await user.type(screen.getByLabelText('任务标题'), createdTask.title);
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    await user.click(screen.getByRole('button', { name: '查看已归档任务' }));
    await user.click(await screen.findByRole('tab', { name: '已完成 1' }));
    expect(await screen.findByText(archivedTask.title)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `恢复任务：${archivedTask.title}` })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看进行中的任务' }));
    await waitFor(() => {
      expect(activeTaskRequests).toBe(2);
    });

    await act(async () => {
      createResponse.resolve(new Response(JSON.stringify(createdTask), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
      staleActiveLoad.resolve(new Response(JSON.stringify(createBoard({ todo: [sourceTask] })), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(activeTaskRequests).toBe(3);
    });
    await user.click(screen.getByRole('tab', { name: '待办 2' }));
    expect(await screen.findByText(createdTask.title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `恢复任务：${createdTask.title}` })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `编辑详情：${createdTask.title}` })).toBeInTheDocument();
  });
});
