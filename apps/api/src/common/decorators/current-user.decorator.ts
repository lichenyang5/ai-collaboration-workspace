import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUserPayload } from '../guards/jwt-auth.guard';

type AuthenticatedRequest = Request & { user?: CurrentUserPayload };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserPayload => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new Error('Current user is unavailable');
    }
    return request.user;
  },
);