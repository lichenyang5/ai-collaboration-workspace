import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { CurrentUserPayload } from '../common/guards/jwt-auth.guard';
import { RealtimeAuthService } from './realtime-auth.service';

const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

interface AuthenticatedSocketData {
  user: CurrentUserPayload;
}

type RealtimeServer = Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  AuthenticatedSocketData
>;

type AuthenticatedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  AuthenticatedSocketData
>;

@WebSocketGateway({
  allowRequest: (request, callback) => {
    callback(null, request.headers.origin === allowedOrigin);
  },
  cors: {
    origin: allowedOrigin,
    credentials: true,
  },
})
export class RealtimeGateway
  implements
    OnGatewayInit<RealtimeServer>,
    OnGatewayConnection<AuthenticatedSocket>
{
  @WebSocketServer()
  server!: RealtimeServer;

  constructor(private readonly auth: RealtimeAuthService) {}

  afterInit(server: RealtimeServer): void {
    server.use(async (client, next) => {
      try {
        client.data.user = await this.auth.authenticate(
          client.handshake.headers.cookie,
        );
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    await client.join(`user:${client.data.user.id}`);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
