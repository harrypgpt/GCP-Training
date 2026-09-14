import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthErrorCode } from '@gcp/shared';

import { AppException } from '../../common/exceptions/app-exception';
import { TokenService } from './token.service';

export interface RequestUser {
  id: string;
  roles: string[];
}

/** Marks a route as public, bypassing {@link JwtAuthGuard} entirely. */
export const Public = Reflector.createDecorator<true>();

interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  user?: RequestUser;
}

/**
 * Verifies the `Authorization: Bearer <token>` access token and populates
 * `request.user = { id, roles }`, which {@link RolesGuard} and application
 * code read from. Applied globally (see AppModule); opt out with `@Public()`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride(Public, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const token = headerValue?.startsWith('Bearer ') ? headerValue.slice('Bearer '.length) : null;

    if (!token) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.UNAUTHENTICATED,
        'Authentication required',
      );
    }

    const { userId, roles } = this.tokens.verifyAccessToken(token);
    request.user = { id: userId, roles };
    return true;
  }
}
