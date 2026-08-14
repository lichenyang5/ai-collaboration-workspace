import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { parse } from 'cookie';
import type { CurrentUserPayload } from '../common/guards/jwt-auth.guard';

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class RealtimeAuthService {
  constructor(private readonly jwtService: JwtService) {}

  async authenticate(cookieHeader: string | undefined): Promise<CurrentUserPayload> {
    const token = parse(cookieHeader ?? '').access_token;
    if (!token) {
      throw new UnauthorizedException('请先登录');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      if (!payload.sub || !payload.email) {
        throw new Error('invalid payload');
      }

      return { id: payload.sub, email: payload.email };
    } catch {
      throw new UnauthorizedException('登录状态已失效');
    }
  }
}
