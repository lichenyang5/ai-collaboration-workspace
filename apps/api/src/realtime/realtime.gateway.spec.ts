import type { Server, Socket } from 'socket.io';
import { TEAM_MEMBERSHIP_CREATED, type TeamMembershipCreatedEvent } from './realtime-events';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeAuthService } from './realtime-auth.service';

describe('RealtimeGateway', () => {
  const event: TeamMembershipCreatedEvent = {
    eventId: 'event-1',
    teamId: 'team-1',
    teamName: 'Example Team',
    role: 'member',
    occurredAt: '2026-08-14T00:00:00.000Z',
  };
  let gateway: RealtimeGateway;
  let authService: jest.Mocked<Pick<RealtimeAuthService, 'authenticate'>>;
  let client: jest.Mocked<Pick<Socket, 'join' | 'disconnect' | 'handshake'>>;
  let emit: jest.Mock;
  let server: jest.Mocked<Pick<Server, 'to'>>;

  beforeEach(() => {
    authService = { authenticate: jest.fn() };
    client = {
      handshake: { headers: { cookie: 'access_token=valid.jwt' } },
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    emit = jest.fn();
    server = {
      to: jest.fn().mockReturnValue({ emit }),
    };
    gateway = new RealtimeGateway(authService as RealtimeAuthService);
    gateway.server = server as Server;
  });

  it('joins only the authenticated user room', async () => {
    authService.authenticate.mockResolvedValue({
      id: 'user-2',
      email: 'b@example.com',
    });

    await gateway.handleConnection(client as Socket);

    expect(client.join).toHaveBeenCalledWith('user:user-2');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects an unauthorized socket without joining a room', async () => {
    authService.authenticate.mockRejectedValue(new Error('invalid'));

    await gateway.handleConnection(client as Socket);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('targets only the requested user room', () => {
    gateway.emitToUser('user-2', TEAM_MEMBERSHIP_CREATED, event);

    expect(server.to).toHaveBeenCalledWith('user:user-2');
    expect(emit).toHaveBeenCalledWith(TEAM_MEMBERSHIP_CREATED, event);
  });
});
