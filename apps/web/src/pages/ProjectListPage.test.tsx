import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProjectListPage } from './ProjectListPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProjectListPage', () => {
  it('loads projects for the selected team', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            id: 'project-1',
            name: '协同工作台 MVP',
            description: '第一阶段交付',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/teams/team-1/projects']}>
        <Routes>
          <Route path="/teams/:teamId/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('协同工作台 MVP')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/teams\/team-1\/projects$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });
  it('creates a project and shows it without reloading the page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/teams/team-1/projects') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ id: 'project-2', name: '设计协作 MVP', description: '' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/teams/team-1/projects']}>
        <Routes>
          <Route path="/teams/:teamId/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('还没有项目，创建一个项目开始协作。');
    await user.type(screen.getByLabelText('项目名称'), '设计协作 MVP');
    await user.click(screen.getByRole('button', { name: '创建项目' }));

    expect(await screen.findByText('设计协作 MVP')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/teams\/team-1\/projects$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: '设计协作 MVP', description: '' }),
      }),
    );
  });

  it('shows the current team name and handles invalid input without native form validation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/api/teams/team-1/projects')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/teams/team-1/members')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/teams')) {
        return new Response(
          JSON.stringify([{ id: 'team-1', name: '冲锋陷阵组', role: 'owner' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/teams/team-1/projects']}>
        <Routes>
          <Route path="/teams/:teamId/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '冲锋陷阵组的项目' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('项目名称'), 'A');
    await user.click(screen.getByRole('button', { name: '创建项目' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('项目名称至少需要 2 个字符');
    expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled();
  });

  it('loads team members and appends an invited member without reloading projects', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/api/teams/team-1/members') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'member-2',
            displayName: '新成员',
            email: 'member@example.com',
            role: 'member',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/teams/team-1/members')) {
        return new Response(
          JSON.stringify([
            { id: 'owner-1', displayName: '负责人', email: 'owner@example.com', role: 'owner' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/teams/team-1/projects')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/teams')) {
        return new Response(
          JSON.stringify([{ id: 'team-1', name: '冲锋陷阵组', role: 'owner' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/teams/team-1/projects']}>
        <Routes>
          <Route path="/teams/:teamId/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
    await user.type(screen.getByLabelText('成员邮箱'), 'member@example.com');
    await user.click(screen.getByRole('button', { name: '邀请成员' }));

    expect(await screen.findByText('新成员')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '邀请成员' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/teams\/team-1\/members$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'member@example.com' }),
      }),
    );
  });

  it('reenables the invitation button after the server rejects an invitation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/api/teams/team-1/members') && init?.method === 'POST') {
        return new Response(JSON.stringify({ message: '该用户已是团队成员' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/teams/team-1/members')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/teams/team-1/projects')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/teams')) {
        return new Response(
          JSON.stringify([{ id: 'team-1', name: '冲锋陷阵组', role: 'owner' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/teams/team-1/projects']}>
        <Routes>
          <Route path="/teams/:teamId/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: '邀请成员' });
    await user.type(screen.getByLabelText('成员邮箱'), 'member@example.com');
    await user.click(screen.getByRole('button', { name: '邀请成员' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('该用户已是团队成员');
    expect(screen.getByRole('button', { name: '邀请成员' })).toBeEnabled();
  });
});
