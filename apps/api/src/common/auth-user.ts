import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/** The signed-in user, as attached to the request by AuthGuard. */
export interface AuthUser {
  id: string;
  role: Role;
  /** BarberProfile id, present only while the user's role is BARBER. */
  barberId: string | null;
}

export const IS_PUBLIC = 'isPublic';
/** No token needed. A valid token is still read, so handlers can adapt to the caller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** "Admin" in the docs: Administrator and Owner. */
export const ADMINS: Role[] = [Role.ADMIN, Role.OWNER];
export const isAdmin = (user?: Pick<AuthUser, 'role'> | null) =>
  !!user && (user.role === Role.ADMIN || user.role === Role.OWNER);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as AuthUser | undefined;
});
