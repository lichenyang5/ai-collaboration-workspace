import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiBaseUrl } from '../services/api';
import type { PublicUser } from '../types/auth';
import {
  TEAM_MEMBERSHIP_CREATED,
  type ClientToServerEvents,
  type RealtimeContextValue,
  type ServerToClientEvents,
  type TeamMembershipCreatedEvent,
} from './realtime-types';

interface RealtimeProviderProps {
  user: PublicUser;
  children: ReactNode;
}

const RealtimeContext = createContext<RealtimeContextValue | undefined>(undefined);

export function RealtimeProvider({ user, children }: RealtimeProviderProps) {
  return <RealtimeSession key={user.id}>{children}</RealtimeSession>;
}

function RealtimeSession({ children }: Pick<RealtimeProviderProps, 'children'>) {
  const [notifications, setNotifications] = useState<TeamMembershipCreatedEvent[]>([]);
  const [teamRefreshVersion, setTeamRefreshVersion] = useState(0);
  const generationRef = useRef(0);
  const seenEventIds = useRef(new Set<string>());

  const dismissNotification = useCallback((eventId: string) => {
    setNotifications((current) => current.filter((notification) => notification.eventId !== eventId));
  }, []);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    seenEventIds.current = new Set();

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(apiBaseUrl, {
      withCredentials: true,
      autoConnect: true,
    });
    let hasConnected = false;
    let initialConnectionFailed = false;
    let reconnecting = false;

    const handleMembershipCreated = (event: TeamMembershipCreatedEvent) => {
      if (generation !== generationRef.current || seenEventIds.current.has(event.eventId)) return;
      seenEventIds.current.add(event.eventId);
      setNotifications((current) => [...current, event]);
      setTeamRefreshVersion((current) => current + 1);
    };

    const handleConnect = () => {
      if (generation !== generationRef.current) return;
      if (!hasConnected) {
        hasConnected = true;
        if (initialConnectionFailed) {
          initialConnectionFailed = false;
          setTeamRefreshVersion((current) => current + 1);
        }
        return;
      }
      if (reconnecting) {
        reconnecting = false;
        setTeamRefreshVersion((current) => current + 1);
      }
    };

    const handleConnectError = () => {
      if (generation !== generationRef.current || hasConnected) return;
      initialConnectionFailed = true;
    };

    const handleDisconnect = () => {
      if (generation !== generationRef.current || !hasConnected) return;
      reconnecting = true;
    };

    socket.on(TEAM_MEMBERSHIP_CREATED, handleMembershipCreated);
    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleDisconnect);

    return () => {
      generationRef.current += 1;
      socket.off(TEAM_MEMBERSHIP_CREATED, handleMembershipCreated);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleDisconnect);
      socket.disconnect();
    };
  }, []);

  return (
    <RealtimeContext.Provider value={{ notifications, dismissNotification, teamRefreshVersion }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const realtime = useContext(RealtimeContext);
  if (!realtime) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }
  return realtime;
}
