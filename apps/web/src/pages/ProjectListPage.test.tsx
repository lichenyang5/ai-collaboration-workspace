import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('reconciles an existing invited member by id with the authoritative response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/api/teams/team-1/members') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'member-user-2',
            displayName: 'Authoritative Member',
            email: 'member@example.com',
            role: 'owner',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/teams/team-1/members')) {
        return new Response(
          JSON.stringify([
            {
              id: 'member-user-2',
              displayName: 'Stale Member',
              email: 'member@example.com',
              role: 'member',
            },
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
          JSON.stringify([{ id: 'team-1', name: 'Team One', role: 'owner' }]),
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

    expect(await screen.findByText('Stale Member')).toBeInTheDocument();
    const emailInput = screen.getByLabelText('\u6210\u5458\u90ae\u7bb1');
    await user.type(emailInput, 'member@example.com');
    await user.click(screen.getByRole('button', { name: '\u9080\u8bf7\u6210\u5458' }));

    expect(await screen.findByText('Authoritative Member')).toBeInTheDocument();
    expect(screen.queryByText('Stale Member')).not.toBeInTheDocument();
    expect(screen.getAllByText('member@example.com')).toHaveLength(1);
    expect(emailInput).toHaveValue('');
    expect(screen.getByRole('button', { name: '\u9080\u8bf7\u6210\u5458' })).toBeEnabled();
  });

  it('issues one invitation request for two synchronous submits and restores the button', async () => {
    let resolveInvitation: (response: Response) => void;
    const invitationResponse = new Promise<Response>((resolve) => {
      resolveInvitation = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/api/teams/team-1/members') && init?.method === 'POST') {
        return invitationResponse;
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
          JSON.stringify([{ id: 'team-1', name: 'Team One', role: 'owner' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/teams/team-1/projects']}>
        <Routes>
          <Route path="/teams/:teamId/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const emailInput = await screen.findByLabelText('\u6210\u5458\u90ae\u7bb1');
    fireEvent.change(emailInput, { target: { value: 'member@example.com' } });
    const invitationForm = emailInput.closest('form');
    expect(invitationForm).not.toBeNull();

    fireEvent.submit(invitationForm!);
    fireEvent.submit(invitationForm!);

    const invitationPosts = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).endsWith('/api/teams/team-1/members') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(invitationPosts).toHaveLength(1);

    resolveInvitation!(
      new Response(
        JSON.stringify({
          id: 'member-user-2',
          displayName: 'Member Two',
          email: 'member@example.com',
          role: 'member',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '\u9080\u8bf7\u6210\u5458' })).toBeEnabled();
    });
  });

  it('clears an old invitation error while a retry is pending and restores the button after failure', async () => {
    let resolveRetry: (response: Response) => void;
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
    let invitationAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/api/teams/team-1/members') && init?.method === 'POST') {
        invitationAttempts += 1;
        if (invitationAttempts === 1) {
          return new Response(JSON.stringify({ message: 'First invitation failed' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return retryResponse;
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
          JSON.stringify([{ id: 'team-1', name: 'Team One', role: 'owner' }]),
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

    const emailInput = await screen.findByLabelText('\u6210\u5458\u90ae\u7bb1');
    await user.type(emailInput, 'member@example.com');
    await user.click(screen.getByRole('button', { name: '\u9080\u8bf7\u6210\u5458' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('First invitation failed');
    const invitationForm = emailInput.closest('form');
    expect(invitationForm).not.toBeNull();
    fireEvent.submit(invitationForm!);

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '\u9080\u8bf7\u4e2d...' })).toBeDisabled();
    });

    resolveRetry!(
      new Response(JSON.stringify({ message: 'Retry invitation failed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Retry invitation failed');
    expect(screen.getByRole('button', { name: '\u9080\u8bf7\u6210\u5458' })).toBeEnabled();
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
