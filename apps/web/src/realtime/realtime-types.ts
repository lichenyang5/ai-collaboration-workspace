export const TEAM_MEMBERSHIP_CREATED = 'team.membership.created' as const;

export interface TeamMembershipCreatedEvent {
  eventId: string;
  teamId: string;
  teamName: string;
  role: 'owner' | 'member';
  occurredAt: string;
}

export interface ServerToClientEvents {
  [TEAM_MEMBERSHIP_CREATED]: (event: TeamMembershipCreatedEvent) => void;
}

export interface ClientToServerEvents {}

export interface RealtimeContextValue {
  notifications: TeamMembershipCreatedEvent[];
  dismissNotification: (eventId: string) => void;
  teamRefreshVersion: number;
}
