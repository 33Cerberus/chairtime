import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { AuthUser, IS_PUBLIC, ROLES } from '../common/auth-user';
import { PrismaService } from '../common/prisma.service';

/**
 * Reads the bearer token and attaches the user to the request.
 *
 * The user is loaded on every request, so a deactivation or a role change takes effect
 * immediately instead of waiting for the access token to expire.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = await this.resolve(req);
    if (user) req.user = user;
    if (!user && !isPublic) throw new UnauthorizedException('Sign in to continue');
    return true;
  }

  private async resolve(req: Request): Promise<AuthUser | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync<{ sub: string }>(header.slice(7))).sub;
    } catch {
      return null;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, role: true, isActive: true, barberProfile: { select: { id: true } } },
    });
    if (!user || !user.isActive) return null;
    return {
      id: user.id,
      role: user.role,
      barberId: user.role === Role.BARBER ? (user.barberProfile?.id ?? null) : null,
    };
  }
}

/** Valid token, but the role is not allowed — 403. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('Your role does not allow this action');
    return true;
  }
}
