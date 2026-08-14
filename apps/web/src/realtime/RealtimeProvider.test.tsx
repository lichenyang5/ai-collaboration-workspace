import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import { RealtimeProvider, useRealtime } from './RealtimeProvider';
import { apiBaseUrl } from '../services/api';
import type { PublicUser } from '../types/auth';

const TEAM_MEMBERSHIP_CREATED = 'team.membership.created';

interface MembershipCreatedEvent {
  eventId: string;
  teamId: string;
  teamName: string;
  role: 'owner' | 'member';
  occurredAt: string;
}

type SocketHandler = (event?: MembershipCreatedEvent) => void;

interface SocketMock {
  handlers: Map<string, SocketHandler>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const socketState = vi.hoisted(() => ({
  sockets: [] as SocketMock[],
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    const handlers = new Map<string, SocketHandler>();
    const socket: SocketMock = {
      handlers,
      on: vi.fn((event: string, handler: SocketHandler) => {
        handlers.set(event, handler);
      }),
      off: vi.fn((event: string, handler: SocketHandler) => {
        if (handlers.get(event) === handler) {
          handlers.delete(event);
        }
      }),
      disconnect: vi.fn(),
    };
    socketState.sockets.push(socket);
    return socket;
  }),
}));

const userOne: PublicUser = {
  id: 'user-1',
  email: 'user-1@example.com',
  displayName: 'User One',
};

const userTwo: PublicUser = {
  id: 'user-2',
  email: 'user-2@example.com',
  displayName: 'User Two',
};

const event: MembershipCreatedEvent = {
  eventId: 'event-1',
  teamId: 'team-1',
  teamName: 'Realtime Team',
  role: 'member',
  occurredAt: '2026-08-14T00:00:00.000Z',
};

function RealtimeState() {
  const { notifications, teamRefreshVersion } = useRealtime();

  return (
    <>
      <output data-testid="notification-count">{notifications.length}</output>
      <output data-testid="team-refresh-version">{teamRefreshVersion}</output>
    </>
  );
}

function renderProvider(user: PublicUser, children: ReactNode = <RealtimeState />) {
  return render(<RealtimeProvider user={user}>{children}</RealtimeProvider>);
}

function registeredHandler(socket: SocketMock, eventName: string): SocketHandler {
  const handler = socket.handlers.get(eventName);
  expect(handler).toBeDefined();
  return handler!;
}

afterEach(() => {
  socketState.sockets.length = 0;
  vi.clearAllMocks();
});

describe('RealtimeProvider', () => {
  it('connects to the API base URL and handles each membership event once', () => {
    renderProvider(userOne);

    expect(io).toHaveBeenCalledWith(apiBaseUrl, {
      withCredentials: true,
      autoConnect: true,
    });

    const handlers = socketState.sockets[0].handlers;
    act(() => handlers.get(TEAM_MEMBERSHIP_CREATED)!(event));
    expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
    expect(screen.getByTestId('team-refresh-version')).toHaveTextContent('1');

    act(() => handlers.get(TEAM_MEMBERSHIP_CREATED)!(event));
    expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
    expect(screen.getByTestId('team-refresh-version')).toHaveTextContent('1');
  });

  it('keeps the first connection at version zero and refreshes after reconnecting', () => {
    renderProvider(userOne);

    const socket = socketState.sockets[0];
    act(() => registeredHandler(socket, 'connect')());
    expect(screen.getByTestId('team-refresh-version')).toHaveTextContent('0');

    act(() => registeredHandler(socket, 'disconnect')());
    act(() => registeredHandler(socket, 'connect')());
    expect(screen.getByTestId('team-refresh-version')).toHaveTextContent('1');
  });

  it('isolates callbacks and state when the authenticated user changes', () => {
    const rendered = renderProvider(userOne);
    const oldSocket = socketState.sockets[0];
    const oldEventHandler = registeredHandler(oldSocket, TEAM_MEMBERSHIP_CREATED);

    act(() => oldEventHandler(event));
    expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
    expect(screen.getByTestId('team-refresh-version')).toHaveTextContent('1');

    rendered.rerender(
      <RealtimeProvider user={userTwo}>
        <RealtimeState />
      </RealtimeProvider>,
    );

    expect(oldSocket.disconnect).toHaveBeenCalledOnce();
    expect(screen.getByTestId('notification-count')).toHaveTextContent('0');
    expect(screen.getByTestId('team-refresh-version')).toHaveTextContent('0');

    act(() => oldEventHandler({ ...event, eventId: 'event-from-user-one' }));
    expect(screen.getByTestId('notification-count')).toHaveTextContent('0');
    expect(screen.getByTestId('team-refresh-version')).toHaveTextContent('0');
  });

  it('disconnects the socket when unmounted', () => {
    const rendered = renderProvider(userOne);
    const socket = socketState.sockets[0];

    rendered.unmount();

    expect(socket.disconnect).toHaveBeenCalledOnce();
  });
});
