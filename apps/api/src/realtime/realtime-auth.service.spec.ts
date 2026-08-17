import { JwtService } from '@nestjs/jwt';
import { RealtimeAuthService } from './realtime-auth.service';

describe('RealtimeAuthService', () => {
  let service: RealtimeAuthService;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;

  beforeEach(() => {
    jwtService = {
      verifyAsync: jest.fn(),
    };
    service = new RealtimeAuthService(jwtService as JwtService);
  });

  it('authenticates the access_token cookie', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-2',
      email: 'b@example.com',
    });

    await expect(
      service.authenticate('theme=dark; access_token=valid.jwt'),
    ).resolves.toEqual({
      id: 'user-2',
      email: 'b@example.com',
    });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid.jwt');
  });

  it.each([undefined, '', 'theme=dark'])(
    'rejects a missing token: %p',
    async (cookieHeader) => {
      await expect(service.authenticate(cookieHeader)).rejects.toThrow('请先登录');
    },
  );

  it.each([
    { sub: '', email: 'b@example.com' },
    { sub: 'user-2', email: '' },
    { sub: undefined, email: 'b@example.com' },
    { sub: 'user-2', email: undefined },
  ])('rejects an invalid JWT payload: %p', async (payload) => {
    jwtService.verifyAsync.mockResolvedValue(payload);

    await expect(service.authenticate('access_token=valid.jwt')).rejects.toThrow(
      '登录状态已失效',
    );
  });

  it('rejects a token when asynchronous JWT verification fails', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(service.authenticate('access_token=invalid.jwt')).rejects.toThrow(
      '登录状态已失效',
    );
  });
});
