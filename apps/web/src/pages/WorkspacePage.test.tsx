import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

    render(<WorkspacePage user={{ id: 'user-1', email: 'demo@example.com', displayName: 'Demo User' }} />);

    expect(await screen.findByText('产品研发组')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/teams$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});