export const TEAM_MEMBERSHIP_CREATED = 'team.membership.created' as const;

export interface TeamMembershipCreatedEvent {
  eventId: string;
  teamId: string;
  teamName: string;
  role: 'member';
  occurredAt: string;
}
