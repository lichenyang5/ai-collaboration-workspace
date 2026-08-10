import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { WorkspacePage } from './WorkspacePage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkspacePage', () => {
  it('loads and displays the current user teams', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([{ id: 'team-1', name: '产品研发组', role: 'owner' }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><WorkspacePage user={{ id: 'user-1', email: 'demo@example.com', displayName: 'Demo User' }} onLogout={vi.fn()} /></MemoryRouter>);

    expect(await screen.findByText('产品研发组')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/teams$/),
      expect.objectContaining({ credentials: 'include' }),
    );
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
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = (await import('@testing-library/user-event')).default.setup();

    render(<MemoryRouter><WorkspacePage user={{ id: 'user-1', email: 'demo@example.com', displayName: 'Demo User' }} onLogout={vi.fn()} /></MemoryRouter>);
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
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <WorkspacePage
          user={{ id: 'user-1', email: 'demo@example.com', displayName: 'Demo User' }}
          onLogout={onLogout}
        />
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
