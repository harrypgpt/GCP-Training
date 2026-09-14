import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { type RequestUser } from './jwt-auth.guard';

/** Injects the authenticated principal populated by {@link JwtAuthGuard}. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    if (!request.user) {
      throw new Error('CurrentUser used outside an authenticated route (missing JwtAuthGuard)');
    }
    return request.user;
  },
);
