import { Injectable, Logger } from '@nestjs/common';
import {
  TEAM_MEMBERSHIP_CREATED,
  type TeamMembershipCreatedEvent,
} from './realtime-events';
import { RealtimeGateway } from './realtime.gateway';

@Injectable()
export class RealtimeNotifier {
  private readonly logger = new Logger(RealtimeNotifier.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  notifyTeamMembershipCreated(
    userId: string,
    payload: TeamMembershipCreatedEvent,
  ): void {
    try {
      this.gateway.emitToUser(userId, TEAM_MEMBERSHIP_CREATED, payload);
    } catch {
      this.logger.error(
        `Failed to emit ${TEAM_MEMBERSHIP_CREATED} to user ${userId}`,
      );
    }
  }
}
