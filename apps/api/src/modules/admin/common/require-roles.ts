import { ForbiddenException } from '@nestjs/common';

import { type RequestUser } from '../../auth/jwt-auth.guard';

/**
 * Programmatic role check for handlers where the required role set depends
 * on request data (e.g. which {@link WorkflowAction} was requested) and so
 * can't be expressed with the static `@Roles()` decorator.
 */
export function requireAnyRole(user: RequestUser, allowed: readonly string[]): void {
  if (!user.roles.some((role) => allowed.includes(role))) {
    throw new ForbiddenException('Insufficient role for this operation');
  }
}
