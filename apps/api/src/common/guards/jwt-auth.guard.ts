import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface CurrentUserPayload {
  id: string;
  email: string;
}

interface JwtPayload {
  sub: string;
  email: string;
}

type AuthenticatedRequest = Request & { user?: CurrentUserPayload };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.access_token;

    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('请先登录');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      request.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('登录状态已失效');
    }
  }
}