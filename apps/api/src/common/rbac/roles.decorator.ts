import { Reflector } from '@nestjs/core';

/**
 * Marks a route (or controller) as requiring one of the listed roles.
 * Enforced by {@link RolesGuard}, which runs after {@link JwtAuthGuard}.
 *
 * Roles are DB rows (`roles` table), not a fixed enum — pass plain strings,
 * or values from `@gcp/shared`'s `UserRole` for the platform's baseline roles.
 *
 * @example
 * ```ts
 * @Roles([UserRole.ADMIN])
 * @Get('users')
 * listUsers() { ... }
 * ```
 */
export const Roles = Reflector.createDecorator<string[]>();
