import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Roles } from './roles.decorator';

interface AuthenticatedRequest {
  /**
   * Populated by {@link JwtAuthGuard}. Role *names* — roles are DB rows
   * (`roles` table), not a fixed enum, so this is `string[]`, not a narrower
   * union. A user can hold multiple roles (many-to-many `user_role_assignments`).
   */
  user?: { id: string; roles: string[] };
}

/**
 * Enforces the {@link Roles} decorator. Routes without the decorator are not
 * gated by this guard. Runs after {@link JwtAuthGuard}, which populates
 * `request.user`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const hasRequiredRole = user.roles.some((role) => required.includes(role));
    if (!hasRequiredRole) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
