import { act, fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { apiRequest } from '../services/api';
import type { PublicUser } from '../types/auth';
import { RealtimeNotificationCenter } from './RealtimeNotificationCenter';
import type { RealtimeContextValue, TeamMembershipCreatedEvent } from './realtime-types';

const realtimeState = vi.hoisted(() => ({
  value: undefined as RealtimeContextValue | undefined,
  providerUsers: [] as PublicUser[],
}));

vi.mock('./RealtimeProvider', () => ({
  RealtimeProvider: ({ user, children }: { user: PublicUser; children: ReactNode }) => {
    realtimeState.providerUsers.push(user);
    return children;
  },
  useRealtime: () => {
    if (!realtimeState.value) {
      throw new Error('Realtime test state has not been configured');
    }
    return realtimeState.value;
  },
}));

vi.mock('../services/api', () => ({
  apiBaseUrl: 'http://localhost:3000',
  apiRequest: vi.fn(),
}));

const apiRequestMock = vi.mocked(apiRequest);

const firstNotification: TeamMembershipCreatedEvent = {
  eventId: 'membership-1',
  teamId: 'team-1',
  teamName: '产品研发组',
  role: 'member',
  occurredAt: '2026-08-14T00:00:00.000Z',
};

const secondNotification: TeamMembershipCreatedEvent = {
  eventId: 'membership-2',
  teamId: 'team-2',
  teamName: '设计协作组',
  role: 'member',
  occurredAt: '2026-08-14T00:00:01.000Z',
};

const authenticatedUser: PublicUser = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: '测试用户',
};

interface NotificationFixtureProps {
  initialNotifications: TeamMembershipCreatedEvent[];
  onDismiss?: (eventId: string) => void;
}

function NotificationFixture({ initialNotifications, onDismiss }: NotificationFixtureProps) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const dismissNotification = useCallback(
    (eventId: string) => {
      onDismiss?.(eventId);
      setNotifications((current) => current.filter((notification) => notification.eventId !== eventId));
    },
    [onDismiss],
  );

  realtimeState.value = {
    notifications,
    dismissNotification,
    teamRefreshVersion: 0,
  };

  return <RealtimeNotificationCenter />;
}

function CurrentLocation() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderNotificationCenter(
  initialNotifications: TeamMembershipCreatedEvent[],
  onDismiss?: (eventId: string) => void,
) {
  return render(
    <MemoryRouter initialEntries={['/workspace']}>
      <NotificationFixture initialNotifications={initialNotifications} onDismiss={onDismiss} />
      <CurrentLocation />
    </MemoryRouter>,
  );
}

afterEach(() => {
  realtimeState.value = undefined;
  realtimeState.providerUsers.length = 0;
  apiRequestMock.mockReset();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('RealtimeNotificationCenter', () => {
  it('shows the first queued invitation with its team destination', () => {
    renderNotificationCenter([firstNotification, secondNotification]);

    expect(screen.getByRole('status')).toHaveTextContent('你已加入「产品研发组」');
    expect(screen.getByRole('link', { name: '查看团队' })).toHaveAttribute(
      'href',
      '/teams/team-1/projects',
    );
    expect(screen.queryByText('你已加入「设计协作组」')).not.toBeInTheDocument();
  });

  it('dismisses the current notification manually before showing the next queued invitation', () => {
    const dismissNotification = vi.fn();
    renderNotificationCenter([firstNotification, secondNotification], dismissNotification);

    fireEvent.click(screen.getByRole('button', { name: '关闭团队邀请通知' }));

    expect(dismissNotification).toHaveBeenCalledOnce();
    expect(dismissNotification).toHaveBeenCalledWith('membership-1');
    expect(screen.getByRole('status')).toHaveTextContent('你已加入「设计协作组」');
  });

  it('automatically dismisses the current notification after five seconds', () => {
    vi.useFakeTimers();
    const dismissNotification = vi.fn();
    renderNotificationCenter([firstNotification], dismissNotification);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(dismissNotification).toHaveBeenCalledOnce();
    expect(dismissNotification).toHaveBeenCalledWith('membership-1');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('dismisses the notification and navigates to its team when viewed', () => {
    const dismissNotification = vi.fn();
    renderNotificationCenter([firstNotification], dismissNotification);

    fireEvent.click(screen.getByRole('link', { name: '查看团队' }));

    expect(dismissNotification).toHaveBeenCalledOnce();
    expect(dismissNotification).toHaveBeenCalledWith('membership-1');
    expect(screen.getByTestId('location')).toHaveTextContent('/teams/team-1/projects');
  });
});

describe('App realtime mounting', () => {
  it('mounts realtime notifications only for a restored authenticated session and keeps anonymous team routes guarded', async () => {
    window.history.replaceState({}, '', '/workspace');
    realtimeState.value = {
      notifications: [firstNotification],
      dismissNotification: vi.fn(),
      teamRefreshVersion: 0,
    };
    apiRequestMock.mockImplementation(async (path: string) => {
      if (path === 'api/auth/me') {
        return authenticatedUser;
      }
      return [];
    });

    const authenticated = render(<App />);

    expect(await screen.findByRole('status')).toHaveTextContent('你已加入「产品研发组」');
    expect(realtimeState.providerUsers).toEqual([authenticatedUser]);

    authenticated.unmount();
    realtimeState.value = undefined;
    window.history.replaceState({}, '', '/teams/team-1/projects');
    apiRequestMock.mockRejectedValueOnce(new Error('not signed in'));

    render(<App />);

    expect(await screen.findByRole('heading', { name: '登录工作区' })).toBeInTheDocument();
    expect(realtimeState.providerUsers).toHaveLength(1);
  });
});
