import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('submits email and password to the login API', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: {
            id: 'user-1',
            email: 'demo@example.com',
            displayName: 'Demo User',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LoginPage onAuthenticated={vi.fn()} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('邮箱'), 'demo@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/login$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ email: 'demo@example.com', password: 'password123' }),
      }),
    );
  });
});