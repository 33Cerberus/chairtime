import { CallHandler, Controller, ExecutionContext, Get, Injectable, Logger, NestInterceptor, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsOptional, IsUUID } from 'class-validator';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AuthUser, Roles } from '../common/auth-user';
import { PageQuery, paging } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Staff shopping for themselves is not staff work. */
const PERSONAL = ['/api/v1/cart', '/api/v1/users/me'];

/**
 * Records who changed what. Every state-changing request made by a barber, an administrator
 * or the owner leaves one row: who, which action, on which record, and whether it went through.
 * Request bodies are deliberately not stored — they hold clients' personal data.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user || user.role === Role.CLIENT || !MUTATING.has(req.method)) return next.handle();
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    if (PERSONAL.some((p) => route.startsWith(p))) return next.handle();

    const record = (statusCode: number) => {
      const targetId = Object.values(req.params ?? {}).find((v): v is string => typeof v === 'string' && UUID.test(v));
      this.prisma.auditLog
        .create({
          data: { actorId: user.id, actorRole: user.role, method: req.method, route, targetId, statusCode, ip: req.ip },
        })
        // The audit trail must never be the reason a request fails.
        .catch((e) => this.logger.error(`Could not write an audit entry: ${e instanceof Error ? e.message : e}`));
    };

    return next.handle().pipe(
      tap({
        next: () => record(context.switchToHttp().getResponse().statusCode),
        error: (e: { getStatus?: () => number }) => record(typeof e?.getStatus === 'function' ? e.getStatus() : 500),
      }),
    );
  }
}

class AuditQuery extends PageQuery {
  @IsOptional() @IsUUID()
  actorId?: string;
}

@ApiTags('Audit log')
@ApiBearerAuth()
@Roles(Role.OWNER)
@Controller('audit-log')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'State-changing actions by staff, newest first. Paginated' })
  async list(@Query() q: AuditQuery) {
    const where = q.actorId ? { actorId: q.actorId } : {};
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, firstName: true, lastName: true } } },
        ...paging(q),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: items.map((a) => ({
        id: a.id,
        createdAt: a.createdAt,
        actor: a.actor,
        actorRole: a.actorRole,
        method: a.method,
        route: a.route,
        targetId: a.targetId,
        statusCode: a.statusCode,
      })),
      total,
    };
  }
}
