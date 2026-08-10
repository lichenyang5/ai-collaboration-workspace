import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
    createdAt,
    assignee: null,
  };
}

function createBoard(tasks: Partial<Record<TaskSummary['status'], TaskSummary[]>> = {}): TaskBoardResponse {
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

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/projects/project-1/board']}>
      <Routes>
        <Route path="/projects/:projectId/board" element={<TaskBoardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TaskBoardPage', () => {
  it('loads tasks into todo, in progress, and done columns', async () => {
    const board = createBoard({
      todo: [createTask('task-1', '梳理项目接口', 'todo')],
      in_progress: [createTask('task-2', '实现登录页面', 'in_progress')],
      done: [createTask('task-3', '发布第一版', 'done')],
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(board), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderBoard();

    expect(await screen.findByRole('heading', { name: '任务协作平台' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '待办' })).toHaveTextContent('梳理项目接口');
    expect(screen.getByRole('region', { name: '进行中' })).toHaveTextContent('实现登录页面');
    expect(screen.getByRole('region', { name: '已完成' })).toHaveTextContent('发布第一版');
    expect(within(screen.getByRole('group', { name: '任务标题' })).getByRole('textbox')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: '任务说明' })).getByRole('textbox')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: '优先级' })).getByRole('combobox')).toBeInTheDocument();
  });

  it('adds a created task to the todo column', async () => {
    const createdTask = createTask('task-4', '实现任务创建', 'todo');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/projects/project-1/tasks') && init?.method === 'POST') {
        return new Response(JSON.stringify(createdTask), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(createBoard()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByRole('heading', { name: '项目任务看板' });
    await user.type(within(screen.getByRole('group', { name: '任务标题' })).getByRole('textbox'), '实现任务创建');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(await within(screen.getByRole('region', { name: '待办' })).findByText('实现任务创建'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建任务' })).toBeEnabled();
  });

  it('moves a task to the requested status after the server accepts the update', async () => {
    const task = createTask('task-1', '梳理项目接口', 'todo');
    const movedTask = { ...task, status: 'in_progress' as const };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/tasks/task-1/status') && init?.method === 'PATCH') {
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

    await screen.findByText('梳理项目接口');
    await user.click(screen.getByRole('button', { name: '移动“梳理项目接口”到进行中' }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '进行中' })).toHaveTextContent('梳理项目接口');
    });
    expect(screen.getByRole('region', { name: '待办' })).not.toHaveTextContent('梳理项目接口');
  });

  it('keeps the task form values when creating a task fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/projects/project-1/tasks') && init?.method === 'POST') {
        return new Response(JSON.stringify({ message: '任务创建失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(createBoard()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByRole('heading', { name: '项目任务看板' });
    const titleInput = within(screen.getByRole('group', { name: '任务标题' })).getByRole('textbox');
    await user.type(titleInput, '保留输入内容');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('任务创建失败');
    expect(titleInput).toHaveValue('保留输入内容');
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/teams/team-1/members')) {
        return new Response(JSON.stringify([assignee]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/projects/project-1/tasks') && init?.method === 'POST') {
        return new Response(JSON.stringify(createdTask), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(createBoard()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderBoard();

    await screen.findByRole('option', { name: '成员一' });
    await user.selectOptions(screen.getByRole('combobox', { name: '负责人' }), assignee.id);
    await user.type(
      within(screen.getByRole('group', { name: '任务标题' })).getByRole('textbox'),
      '分配负责人任务',
    );
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
});
