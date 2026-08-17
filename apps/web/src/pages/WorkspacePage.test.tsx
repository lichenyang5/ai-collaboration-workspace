import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { PublicUser } from '../types/auth';
import { WorkspacePage } from './WorkspacePage';

const realtimeState = vi.hoisted(() => ({ teamRefreshVersion: 0 }));

vi.mock('../realtime/RealtimeProvider', () => ({
  useRealtime: () => ({
    notifications: [],
    dismissNotification: vi.fn(),
    teamRefreshVersion: realtimeState.teamRefreshVersion,
  }),
}));

const userOne: PublicUser = {
  id: 'user-1',
  email: 'demo@example.com',
  displayName: 'Demo User',
};

const userTwo: PublicUser = {
  id: 'user-2',
  email: 'other@example.com',
  displayName: 'Other User',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function teamsResponse(teams: Array<{ id: string; name: string; role: 'owner' | 'member' }>) {
  return new Response(JSON.stringify(teams), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderWorkspace(user: PublicUser = userOne) {
  return render(
    <MemoryRouter>
      <WorkspacePage user={user} onLogout={vi.fn()} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  realtimeState.teamRefreshVersion = 0;
  vi.unstubAllGlobals();
});

describe('WorkspacePage', () => {
  it('loads and displays the current user teams', async () => {
    const fetchMock = vi.fn(async () =>
      teamsResponse([{ id: 'team-1', name: '产品研发组', role: 'owner' }]),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWorkspace();

    expect(await screen.findByText('产品研发组')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/teams$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('replaces the team list when the realtime refresh version increases', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(teamsResponse([{ id: 'team-1', name: '旧团队', role: 'owner' }]))
      .mockResolvedValueOnce(teamsResponse([
        { id: 'team-1', name: '旧团队', role: 'owner' },
        { id: 'team-2', name: '新团队', role: 'member' },
      ]));
    vi.stubGlobal('fetch', fetchMock);
    const rendered = renderWorkspace();
    await screen.findByText('旧团队');

    realtimeState.teamRefreshVersion = 1;
    rendered.rerender(
      <MemoryRouter>
        <WorkspacePage user={userOne} onLogout={vi.fn()} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('新团队')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps one GET in flight and performs one final catch-up after repeated invalidations', async () => {
    const pendingRefresh = deferred<Response>();
    const finalRefresh = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(teamsResponse([{ id: 'team-1', name: '旧团队', role: 'owner' }]))
      .mockReturnValueOnce(pendingRefresh.promise)
      .mockReturnValueOnce(finalRefresh.promise);
    vi.stubGlobal('fetch', fetchMock);
    const rendered = renderWorkspace();
    await screen.findByText('旧团队');

    realtimeState.teamRefreshVersion = 1;
    rendered.rerender(<MemoryRouter><WorkspacePage user={userOne} onLogout={vi.fn()} /></MemoryRouter>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    realtimeState.teamRefreshVersion = 2;
    rendered.rerender(<MemoryRouter><WorkspacePage user={userOne} onLogout={vi.fn()} /></MemoryRouter>);
    realtimeState.teamRefreshVersion = 3;
    rendered.rerender(<MemoryRouter><WorkspacePage user={userOne} onLogout={vi.fn()} /></MemoryRouter>);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingRefresh.resolve(teamsResponse([{ id: 'team-2', name: '中间团队', role: 'member' }]));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    await act(async () => {
      finalRefresh.resolve(teamsResponse([{ id: 'team-3', name: '最终团队', role: 'member' }]));
    });
    expect(await screen.findByText('最终团队')).toBeInTheDocument();
    expect(screen.queryByText('中间团队')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the old teams and reports the realtime copy when refresh fails', async () => {
    const pendingRefresh = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(teamsResponse([{ id: 'team-1', name: '旧团队', role: 'owner' }]))
      .mockReturnValueOnce(pendingRefresh.promise);
    vi.stubGlobal('fetch', fetchMock);
    const rendered = renderWorkspace();
    await screen.findByText('旧团队');

    realtimeState.teamRefreshVersion = 1;
    rendered.rerender(<MemoryRouter><WorkspacePage user={userOne} onLogout={vi.fn()} /></MemoryRouter>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      pendingRefresh.reject(new Error('network unavailable'));
    });

    expect(screen.getByText('旧团队')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('实时同步失败，可刷新页面重试');
  });

  it('clears a realtime error and catches up after a later successful invalidation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(teamsResponse([{ id: 'team-1', name: '旧团队', role: 'owner' }]))
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(teamsResponse([{ id: 'team-2', name: '恢复团队', role: 'member' }]));
    vi.stubGlobal('fetch', fetchMock);
    const rendered = renderWorkspace();
    await screen.findByText('旧团队');

    realtimeState.teamRefreshVersion = 1;
    rendered.rerender(<MemoryRouter><WorkspacePage user={userOne} onLogout={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('实时同步失败，可刷新页面重试');

    realtimeState.teamRefreshVersion = 2;
    rendered.rerender(<MemoryRouter><WorkspacePage user={userOne} onLogout={vi.fn()} /></MemoryRouter>);

    expect(await screen.findByText('恢复团队')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('旧团队')).not.toBeInTheDocument();
  });

  it('ignores an obsolete successful GET after the user changes', async () => {
    const oldUserLoad = deferred<Response>();
    const newUserLoad = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(oldUserLoad.promise)
      .mockReturnValueOnce(newUserLoad.promise);
    vi.stubGlobal('fetch', fetchMock);
    const rendered = renderWorkspace(userOne);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rendered.rerender(<MemoryRouter><WorkspacePage user={userTwo} onLogout={vi.fn()} /></MemoryRouter>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      newUserLoad.resolve(teamsResponse([{ id: 'team-2', name: '新用户团队', role: 'owner' }]));
    });
    expect(await screen.findByText('新用户团队')).toBeInTheDocument();

    await act(async () => {
      oldUserLoad.resolve(teamsResponse([{ id: 'team-1', name: '旧用户团队', role: 'owner' }]));
    });
    expect(screen.getByText('新用户团队')).toBeInTheDocument();
    expect(screen.queryByText('旧用户团队')).not.toBeInTheDocument();
  });

  it('ignores obsolete GET errors and finally work after the user changes', async () => {
    const oldUserLoad = deferred<Response>();
    const newUserLoad = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(oldUserLoad.promise)
      .mockReturnValueOnce(newUserLoad.promise);
    vi.stubGlobal('fetch', fetchMock);
    const rendered = renderWorkspace(userOne);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rendered.rerender(<MemoryRouter><WorkspacePage user={userTwo} onLogout={vi.fn()} /></MemoryRouter>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      oldUserLoad.reject(new Error('old user failed'));
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('正在加载团队…')).toBeInTheDocument();
    await act(async () => {
      newUserLoad.resolve(teamsResponse([{ id: 'team-2', name: '新用户团队', role: 'owner' }]));
    });
    expect(await screen.findByText('新用户团队')).toBeInTheDocument();
  });

  it('keeps a newly created team when an older GET resolves and then reconciles with the server', async () => {
    const oldLoad = deferred<Response>();
    const reconciledLoad = deferred<Response>();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(
          JSON.stringify({ id: 'team-2', name: '设计协作组' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ));
      }
      if (fetchMock.mock.calls.length === 1) {
        return oldLoad.promise;
      }
      return reconciledLoad.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText('团队名称'), '设计协作组');
    await user.click(screen.getByRole('button', { name: '创建团队' }));
    expect(await screen.findByText('设计协作组')).toBeInTheDocument();

    await act(async () => {
      oldLoad.resolve(teamsResponse([]));
    });
    expect(screen.getByText('设计协作组')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    await act(async () => {
      reconciledLoad.resolve(teamsResponse([{ id: 'team-2', name: '设计协作组', role: 'owner' }]));
    });
    expect(await screen.findByText('设计协作组')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('creates a team and adds it to the current list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/teams') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ id: 'team-2', name: '设计协作组' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return teamsResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWorkspace();
    await screen.findByText('还没有团队，下一步可以创建你的第一个团队。');
    await user.type(screen.getByLabelText('团队名称'), '设计协作组');
    await user.click(screen.getByRole('button', { name: '创建团队' }));

    expect(await screen.findByText('设计协作组')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/teams$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: '设计协作组' }),
      }),
    );
  });

  it('requests logout and clears the application session after completion', async () => {
    const onLogout = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/auth/logout') && init?.method === 'POST') {
        return new Response(null, { status: 204 });
      }

      if (url.endsWith('/api/teams')) {
        return teamsResponse([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <WorkspacePage user={userOne} onLogout={onLogout} />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: '退出登录' }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/logout$/),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
