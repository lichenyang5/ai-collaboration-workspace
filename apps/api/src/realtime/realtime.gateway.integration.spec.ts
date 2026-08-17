import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway websocket handshake', () => {
  const allowedOrigin =
    process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  const userId = 'integration-user-2';
  const clients: ClientSocket[] = [];
  let app: INestApplication;
  let gateway: RealtimeGateway;
  let jwtService: JwtService;
  let serverUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        RealtimeAuthService,
        {
          provide: JwtService,
          useValue: new JwtService({ secret: 'realtime-integration-test-secret' }),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;
    gateway = app.get(RealtimeGateway);
    jwtService = app.get(JwtService);
  });

  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
  });

  afterAll(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
    await app.close();
  });

  it('accepts the allowed origin with a valid cookie and joins the user room', async () => {
    const token = await jwtService.signAsync({
      sub: userId,
      email: 'integration@example.com',
    });
    const client = createClient({
      Origin: allowedOrigin,
      Cookie: `access_token=${token}`,
    });

    await expect(waitForConnection(client)).resolves.toBeUndefined();
    await waitForCondition(
      () =>
        gateway.server.sockets.sockets
          .get(client.id ?? '')
          ?.rooms.has(`user:${userId}`) === true,
    );

    expect(client.connected).toBe(true);
  });

  it('rejects a websocket request from a different origin', async () => {
    const token = await jwtService.signAsync({
      sub: userId,
      email: 'integration@example.com',
    });
    const rejectedOrigin =
      allowedOrigin === 'http://disallowed.example'
        ? 'http://another-disallowed.example'
        : 'http://disallowed.example';
    const client = createClient({
      Origin: rejectedOrigin,
      Cookie: `access_token=${token}`,
    });

    await expect(waitForConnection(client)).rejects.toBeInstanceOf(Error);
    expect(client.connected).toBe(false);
  });

  it('rejects a websocket request without an origin', async () => {
    const token = await jwtService.signAsync({
      sub: userId,
      email: 'integration@example.com',
    });
    const client = createClient({
      Cookie: `access_token=${token}`,
    });

    await expect(waitForConnection(client)).rejects.toBeInstanceOf(Error);
    expect(client.connected).toBe(false);
  });

  it.each([
    ['a missing cookie', undefined],
    ['an invalid cookie', 'access_token=invalid.jwt'],
  ])('rejects the allowed origin with %s', async (_label, cookieHeader) => {
    const client = createClient({
      Origin: allowedOrigin,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    });

    await expect(waitForConnection(client)).rejects.toBeInstanceOf(Error);
    expect(client.connected).toBe(false);
  });

  function createClient(extraHeaders: Record<string, string>): ClientSocket {
    const client = io(serverUrl, {
      autoConnect: false,
      extraHeaders,
      forceNew: true,
      reconnection: false,
      timeout: 2_000,
      transports: ['websocket'],
    });
    clients.push(client);
    return client;
  }

  function waitForConnection(client: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        client.off('connect', handleConnect);
        client.off('connect_error', handleConnectError);
      };
      const handleConnect = () => {
        cleanup();
        resolve();
      };
      const handleConnectError = (error: Error) => {
        cleanup();
        reject(error);
      };

      client.on('connect', handleConnect);
      client.on('connect_error', handleConnectError);
      client.connect();
    });
  }

  function waitForCondition(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000;

    return new Promise((resolve, reject) => {
      const check = () => {
        if (condition()) {
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error('Timed out waiting for the authenticated user room'));
          return;
        }
        setTimeout(check, 10);
      };

      check();
    });
  }
});
