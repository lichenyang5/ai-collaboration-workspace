import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RegisterPage } from './RegisterPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RegisterPage', () => {
  it('submits registration details to the registration API', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: {
            id: 'user-1',
            email: 'demo@example.com',
            displayName: 'Demo User',
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <RegisterPage onAuthenticated={vi.fn()} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('昵称'), 'Demo User');
    await user.type(screen.getByLabelText('邮箱'), 'demo@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '注册并进入工作区' }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/register$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          displayName: 'Demo User',
          email: 'demo@example.com',
          password: 'password123',
        }),
      }),
    );
  });
});