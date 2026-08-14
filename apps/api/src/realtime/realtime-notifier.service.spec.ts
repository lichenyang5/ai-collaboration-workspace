import { Logger } from '@nestjs/common';
import { TEAM_MEMBERSHIP_CREATED, type TeamMembershipCreatedEvent } from './realtime-events';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeNotifier } from './realtime-notifier.service';

describe('RealtimeNotifier', () => {
  const event: TeamMembershipCreatedEvent = {
    eventId: 'event-1',
    teamId: 'team-1',
    teamName: 'Example Team',
    role: 'member',
    occurredAt: '2026-08-14T00:00:00.000Z',
  };
  let notifier: RealtimeNotifier;
  let gateway: jest.Mocked<Pick<RealtimeGateway, 'emitToUser'>>;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    gateway = { emitToUser: jest.fn() };
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    notifier = new RealtimeNotifier(gateway as RealtimeGateway);
  });

  afterEach(() => {
    loggerError.mockRestore();
  });

  it('forwards membership-created events to the requested user', () => {
    notifier.notifyTeamMembershipCreated('user-2', event);

    expect(gateway.emitToUser).toHaveBeenCalledWith(
      'user-2',
      TEAM_MEMBERSHIP_CREATED,
      event,
    );
  });

  it('does not throw when socket emission fails', () => {
    gateway.emitToUser.mockImplementation(() => {
      throw new Error('socket unavailable');
    });

    expect(() => notifier.notifyTeamMembershipCreated('user-2', event)).not.toThrow();
    expect(loggerError).toHaveBeenCalled();
  });
});
