import { ForbiddenException, Injectable } from '@nestjs/common';
import { BookingStatus, Prisma, Role } from '@prisma/client';
import { AuthService, hashPassword, verifyPassword } from '../auth/auth.service';
import { BookingsService } from '../bookings/bookings.service';
import { AuthUser, isAdmin } from '../common/auth-user';
import { badRequest, conflict, notFound } from '../common/errors';
import { paging } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { toUserView } from '../common/user-view';
import { OrdersService } from '../orders/orders.controller';
import { ChangeRoleDto, CreateClientDto, CreateStaffDto, UpdateMeDto, UpdateUserDto, UsersQuery } from './users.dto';

const WITH_PROFILE = { barberProfile: { select: { id: true } } } satisfies Prisma.UserInclude;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly bookings: BookingsService,
    private readonly orders: OrdersService,
  ) {}

  private async find(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: WITH_PROFILE });
    if (!user) throw notFound('User');
    return user;
  }

  async get(id: string) {
    return toUserView(await this.find(id));
  }

  async list(q: UsersQuery) {
    const terms = q.search?.split(/\s+/).filter(Boolean) ?? [];
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
      AND: terms.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: 'insensitive' as const } },
          { lastName: { contains: t, mode: 'insensitive' as const } },
          { phoneNumber: { contains: t.replace(/[^\d+]/g, '') || t } },
        ],
      })),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: WITH_PROFILE,
        orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }, { lastName: 'asc' }],
        ...paging(q),
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(toUserView), total };
  }

  private async assertUnique(dto: { phoneNumber?: string; email?: string | null }, exceptId?: string) {
    if (dto.phoneNumber) {
      const owner = await this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } });
      if (owner && owner.id !== exceptId) throw conflict('This phone number is already in use', 'PHONE_TAKEN');
    }
    if (dto.email) {
      const owner = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (owner && owner.id !== exceptId) throw conflict('This e-mail address is already in use', 'EMAIL_TAKEN');
    }
  }

  // ---- Own account ------------------------------------------------------------------------

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.find(userId);
    await this.assertUnique(dto, userId);
    const { password, currentPassword, ...fields } = dto;
    let passwordHash: string | undefined;
    if (password) {
      // Changing the password requires knowing the current one, so a stolen session cannot lock the owner out.
      const ok = !!user.passwordHash && !!currentPassword && (await verifyPassword(user.passwordHash, currentPassword));
      if (!ok) throw badRequest('Your current password is wrong', [{ field: 'currentPassword', errors: ['Wrong password'] }]);
      passwordHash = await hashPassword(password);
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { ...fields, ...(passwordHash ? { passwordHash } : {}) },
      include: WITH_PROFILE,
    });
    return toUserView(updated);
  }

  // ---- Managing others ----------------------------------------------------------------------

  /** Administrators manage clients and barbers; only the owner manages administrators. */
  private assertCanManage(actor: AuthUser, target: { id: string; role: Role }) {
    if (actor.id === target.id) return;
    if (target.role === Role.OWNER) throw new ForbiddenException("Only the owner manages the owner's account");
    if (target.role === Role.ADMIN && actor.role !== Role.OWNER) {
      throw new ForbiddenException('Only the owner manages administrator accounts');
    }
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto) {
    const target = await this.find(id);
    this.assertCanManage(actor, target);
    await this.assertUnique(dto, id);
    const updated = await this.prisma.user.update({ where: { id }, data: dto, include: WITH_PROFILE });
    return toUserView(updated);
  }

  /** A client record with a name and phone only — for bookings taken by phone or at the desk. */
  async createClient(dto: CreateClientDto) {
    await this.assertUnique(dto);
    const user = await this.prisma.user.create({ data: { ...dto, role: Role.CLIENT }, include: WITH_PROFILE });
    return toUserView(user);
  }

  /**
   * Creates a barber or an administrator. The account has no password: the response carries a
   * single-use link that the owner hands to the new staff member, who then picks their own.
   */
  async createStaff(dto: CreateStaffDto) {
    await this.assertUnique(dto);
    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        email: dto.email ?? null,
        role: dto.role,
        ...(dto.role === Role.BARBER ? { barberProfile: { create: {} } } : {}),
      },
      include: WITH_PROFILE,
    });
    return { user: toUserView(user), passwordLink: await this.auth.createPasswordLink(user.id) };
  }

  /** A fresh single-use link, for a lost invite or a forgotten password. */
  async passwordLink(actor: AuthUser, id: string) {
    const target = await this.find(id);
    if (target.role === Role.OWNER) throw new ForbiddenException('The owner resets their own password from the sign-in page');
    this.assertCanManage(actor, target);
    if (!target.isActive) throw conflict('Reactivate this account first', 'ACCOUNT_INACTIVE');
    return this.auth.createPasswordLink(id);
  }

  private async futureBookingsAsBarber(barberId: string | undefined) {
    if (!barberId) return 0;
    return this.prisma.booking.count({
      where: { barberId, status: { in: [BookingStatus.BOOKED, BookingStatus.IN_PROGRESS] }, startAt: { gt: new Date() } },
    });
  }

  async changeRole(id: string, dto: ChangeRoleDto) {
    const target = await this.find(id);
    if (target.role === Role.OWNER) throw conflict("The owner's role cannot be changed", 'OWNER_PROTECTED');
    if (target.role === dto.role) return toUserView(target);
    if (target.role === Role.BARBER) {
      const pending = await this.futureBookingsAsBarber(target.barberProfile?.id);
      if (pending) {
        throw conflict(
          `This barber has ${pending} upcoming booking${pending > 1 ? 's' : ''}. Move or cancel them before changing the role.`,
          'HAS_FUTURE_BOOKINGS',
        );
      }
    }
    // The profile row is kept when a barber changes role, because past bookings reference it;
    // it simply stops being listed. Becoming a barber again reuses it.
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        role: dto.role,
        ...(dto.role === Role.BARBER && !target.barberProfile ? { barberProfile: { create: {} } } : {}),
      },
      include: WITH_PROFILE,
    });
    await this.auth.revokeAllSessions(id);
    return toUserView(updated);
  }

  // ---- Deactivation -----------------------------------------------------------------------

  async deactivate(actor: AuthUser, id: string) {
    const target = await this.find(id);
    if (target.role === Role.OWNER) throw conflict('The owner cannot be deactivated', 'OWNER_PROTECTED');
    const self = actor.id === id;
    if (self && target.role !== Role.CLIENT) {
      throw new ForbiddenException('Staff accounts are deactivated by an administrator');
    }
    if (!self) {
      if (!isAdmin(actor)) throw notFound('User');
      this.assertCanManage(actor, target);
    }
    if (!target.isActive) return { user: toUserView(target), canceledBookings: 0, canceledOrders: 0 };

    if (target.role === Role.BARBER) {
      const pending = await this.futureBookingsAsBarber(target.barberProfile?.id);
      if (pending) {
        throw conflict(
          `This barber has ${pending} upcoming booking${pending > 1 ? 's' : ''}. Move or cancel them first.`,
          'HAS_FUTURE_BOOKINGS',
        );
      }
    }

    // Whatever the person had coming up as a customer is released.
    const canceledBookings = await this.bookings.cancelUpcomingOfClient(id, 'Account deactivated');
    const canceledOrders = await this.orders.cancelOpenOfClient(id);
    const updated = await this.prisma.user.update({ where: { id }, data: { isActive: false }, include: WITH_PROFILE });
    await this.auth.revokeAllSessions(id);
    return { user: toUserView(updated), canceledBookings, canceledOrders };
  }

  async activate(actor: AuthUser, id: string) {
    const target = await this.find(id);
    this.assertCanManage(actor, target);
    const updated = await this.prisma.user.update({ where: { id }, data: { isActive: true }, include: WITH_PROFILE });
    return toUserView(updated);
  }
}
