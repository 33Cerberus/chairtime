import { Injectable } from '@nestjs/common';
import { BookingStatus, PaymentStatus, Prisma, Role } from '@prisma/client';
import { DateTime } from 'luxon';
import { AuthUser, isAdmin } from '../common/auth-user';
import { badRequest, conflict, notFound } from '../common/errors';
import { Page, paging } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import {
  BUFFER_MIN,
  CLIENT_CHANGE_WINDOW_HOURS,
  EARLY_START_MIN,
  HOUR,
  MINUTE,
  NO_SHOW_WAIT_MIN,
  SHOP_TZ,
} from '../common/time';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { AvailabilityService } from '../schedule/availability.service';
import { BookingsQuery, CancelBookingDto, CreateBookingDto } from './bookings.dto';

const INCLUDE = {
  service: { select: { id: true, name: true } },
  barber: { select: { id: true, photoUrl: true, user: { select: { firstName: true, lastName: true } } } },
  client: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
} satisfies Prisma.BookingInclude;

type BookingRow = Prisma.BookingGetPayload<{ include: typeof INCLUDE }>;

const TERMINAL: BookingStatus[] = [BookingStatus.COMPLETED, BookingStatus.CANCELED, BookingStatus.NO_SHOW];
const ACTIVE: BookingStatus[] = [BookingStatus.BOOKED, BookingStatus.IN_PROGRESS];

const when = (d: Date) => DateTime.fromJSDate(d, { zone: SHOP_TZ }).toFormat("ccc d LLL 'at' HH:mm");

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The booking as the caller sees it. `actions` says what this caller may do right now,
   * so the rules of roles.md live in one place and the interface never has to guess.
   */
  private view(b: BookingRow, viewer: AuthUser) {
    const now = Date.now();
    const start = b.startAt.getTime();
    const admin = isAdmin(viewer);
    const isClient = b.clientId === viewer.id;
    const isBarber = !!viewer.barberId && viewer.barberId === b.barberId;
    const staff = admin || isBarber;
    const inWindow = start - now >= CLIENT_CHANGE_WINDOW_HOURS * HOUR;
    const booked = b.status === BookingStatus.BOOKED;
    return {
      id: b.id,
      startAt: b.startAt,
      /** When the service itself ends. */
      serviceEndAt: new Date(start + b.durationSnapshot * MINUTE),
      /** End of the reserved time, including the 15-minute buffer. */
      endAt: b.endAt,
      status: b.status,
      paymentStatus: b.paymentStatus,
      priceSnapshot: b.priceSnapshot,
      durationSnapshot: b.durationSnapshot,
      note: b.note,
      canceledAt: b.canceledAt,
      cancelReason: b.cancelReason,
      createdAt: b.createdAt,
      service: b.service,
      barber: {
        id: b.barber.id,
        firstName: b.barber.user.firstName,
        lastName: b.barber.user.lastName,
        photoUrl: b.barber.photoUrl,
      },
      client: b.client,
      actions: {
        move: booked && (admin || (isClient && inWindow)),
        cancel: booked && (admin || (isClient && inWindow)),
        pay: this.payments.enabled && isClient && ACTIVE.includes(b.status) && b.paymentStatus === PaymentStatus.UNPAID,
        start: staff && booked && now >= start - EARLY_START_MIN * MINUTE,
        complete: staff && b.status === BookingStatus.IN_PROGRESS,
        noShow: staff && booked && now >= start + NO_SHOW_WAIT_MIN * MINUTE,
        markPaid: admin && b.paymentStatus === PaymentStatus.UNPAID && b.status !== BookingStatus.CANCELED,
        refund: admin && b.paymentStatus === PaymentStatus.PAID,
      },
    };
  }

  /** Loads a booking the caller may see; anything else is a 404. */
  private async visible(user: AuthUser, id: string) {
    const b = await this.prisma.booking.findUnique({ where: { id }, include: INCLUDE });
    if (!b) throw notFound('Booking');
    const allowed =
      isAdmin(user) || b.clientId === user.id || (user.role === Role.BARBER && user.barberId === b.barberId);
    if (!allowed) throw notFound('Booking');
    return b;
  }

  /** Create, move, cancel: the client it belongs to, or an administrator. */
  private async editable(user: AuthUser, id: string) {
    const b = await this.visible(user, id);
    if (!isAdmin(user) && b.clientId !== user.id) throw notFound('Booking');
    return b;
  }

  /** Status changes: the barber it is assigned to, or an administrator. */
  private async workable(user: AuthUser, id: string) {
    const b = await this.visible(user, id);
    if (!isAdmin(user) && user.barberId !== b.barberId) throw notFound('Booking');
    return b;
  }

  // ---- Reading ----------------------------------------------------------------------------

  async list(user: AuthUser, q: BookingsQuery): Promise<Page<ReturnType<BookingsService['view']>>> {
    const where: Prisma.BookingWhereInput = {};
    if (isAdmin(user)) {
      if (q.barberId) where.barberId = q.barberId;
      if (q.clientId) where.clientId = q.clientId;
    } else if (user.role === Role.BARBER) {
      where.barberId = user.barberId ?? '00000000-0000-0000-0000-000000000000';
    } else {
      where.clientId = user.id;
      if (q.barberId) where.barberId = q.barberId;
    }
    if (q.status?.length) where.status = { in: q.status };
    if (q.from || q.to) {
      where.startAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) };
    }
    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: INCLUDE,
        orderBy: { startAt: q.order ?? 'asc' },
        ...paging(q),
      }),
      this.prisma.booking.count({ where }),
    ]);
    return { items: items.map((b) => this.view(b, user)), total };
  }

  async get(user: AuthUser, id: string) {
    return this.view(await this.visible(user, id), user);
  }

  // ---- Creating and moving ------------------------------------------------------------------

  async create(user: AuthUser, dto: CreateBookingDto) {
    const admin = isAdmin(user);
    const clientId = admin ? dto.clientId : user.id;
    if (!clientId) throw badRequest('clientId is required when booking on behalf of a client');

    const [client, offer] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: clientId } }),
      this.prisma.barberService.findUnique({
        where: { barberId_serviceId: { barberId: dto.barberId, serviceId: dto.serviceId } },
        include: { service: true, barber: { include: { user: true } } },
      }),
    ]);
    if (!client || !client.isActive) throw notFound('Client');
    if (!offer) throw conflict('This barber does not offer this service', 'NOT_OFFERED');
    if (!offer.service.isActive) throw conflict('This service is no longer available', 'SERVICE_INACTIVE');
    if (!offer.barber.user.isActive || offer.barber.user.role !== Role.BARBER) {
      throw conflict('This barber is no longer taking bookings', 'BARBER_INACTIVE');
    }

    const startAt = new Date(dto.startAt);
    const duration = offer.service.duration;
    await this.availability.assertBookable(dto.barberId, startAt, duration);

    // Price and duration are copied in: later catalog changes never touch this booking.
    // Two guarantees against a race: the exclusion constraint in the database keeps a barber's
    // bookings from overlapping, and the per-client lock makes "is the client free?" and the
    // insert one step, so two simultaneous requests cannot both pass the check.
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockClient(tx, clientId);
      await this.assertClientFree(tx, clientId, startAt, duration);
      return tx.booking.create({
        data: {
          clientId,
          barberId: dto.barberId,
          serviceId: dto.serviceId,
          startAt,
          endAt: new Date(startAt.getTime() + (duration + BUFFER_MIN) * MINUTE),
          priceSnapshot: offer.price,
          durationSnapshot: duration,
          note: dto.note?.trim() || null,
        },
        include: INCLUDE,
      });
    });
    await this.notifications.notify(
      clientId,
      'BOOKING_CONFIRMED',
      `You're booked: ${created.service.name} with ${created.barber.user.firstName}, ${when(startAt)}.`,
      created.id,
    );
    return this.view(created, user);
  }

  /** Serialises the booking changes of one client for the length of the transaction. */
  private async lockClient(tx: Prisma.TransactionClient, clientId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientId}))`;
  }

  /** A person cannot sit in two chairs at once. */
  private async assertClientFree(
    tx: Prisma.TransactionClient,
    clientId: string,
    startAt: Date,
    duration: number,
    excludeId?: string,
  ) {
    const serviceEnd = startAt.getTime() + duration * MINUTE;
    const nearby = await tx.booking.findMany({
      where: {
        clientId,
        status: { in: ACTIVE },
        startAt: { lt: new Date(serviceEnd) },
        endAt: { gt: startAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { startAt: true, durationSnapshot: true },
    });
    const clash = nearby.some((b) => b.startAt.getTime() + b.durationSnapshot * MINUTE > startAt.getTime());
    if (clash) throw conflict('The client already has a booking at this time', 'CLIENT_BUSY');
  }

  private assertClientWindow(user: AuthUser, startAt: Date, verb: string) {
    if (isAdmin(user)) return;
    if (startAt.getTime() - Date.now() < CLIENT_CHANGE_WINDOW_HOURS * HOUR) {
      throw conflict(
        `A booking can be ${verb} up to ${CLIENT_CHANGE_WINDOW_HOURS} hours before it starts. Please call the shop.`,
        'TOO_LATE',
      );
    }
  }

  /** Moving changes the time only. A different barber or service means cancel and re-book. */
  async move(user: AuthUser, id: string, startAtIso: string) {
    const b = await this.editable(user, id);
    if (b.status !== BookingStatus.BOOKED) throw conflict('Only an upcoming booking can be moved', 'NOT_MOVABLE');
    this.assertClientWindow(user, b.startAt, 'moved');
    const startAt = new Date(startAtIso);
    if (startAt.getTime() === b.startAt.getTime()) return this.view(b, user);

    // The stored duration is used, so a later change to the service does not resize this booking.
    await this.availability.assertBookable(b.barberId, startAt, b.durationSnapshot, b.id);
    const moved = await this.prisma.$transaction(async (tx) => {
      await this.lockClient(tx, b.clientId);
      await this.assertClientFree(tx, b.clientId, startAt, b.durationSnapshot, b.id);
      // Only a booking that is still BOOKED moves: it may have been canceled or started meanwhile.
      const changed = await tx.booking.updateMany({
        where: { id, status: BookingStatus.BOOKED },
        data: {
          startAt,
          endAt: new Date(startAt.getTime() + (b.durationSnapshot + BUFFER_MIN) * MINUTE),
          reminderSentAt: null,
        },
      });
      if (changed.count !== 1) throw conflict('This booking has just changed. Reload and try again.', 'NOT_MOVABLE');
      return tx.booking.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    await this.notifications.notify(
      b.clientId,
      'BOOKING_MOVED',
      `Your ${b.service.name} with ${b.barber.user.firstName} is now ${when(startAt)}.`,
      id,
    );
    return this.view(moved, user);
  }

  // ---- Canceling ----------------------------------------------------------------------------

  async cancel(user: AuthUser, id: string, dto: CancelBookingDto) {
    const b = await this.editable(user, id);
    if (b.status !== BookingStatus.BOOKED) {
      throw conflict(
        TERMINAL.includes(b.status) ? 'This booking is already closed' : 'A visit that has started cannot be canceled',
        'NOT_CANCELABLE',
      );
    }
    this.assertClientWindow(user, b.startAt, 'canceled');
    const inWindow = b.startAt.getTime() - Date.now() >= CLIENT_CHANGE_WINDOW_HOURS * HOUR;
    const refund = isAdmin(user) ? (dto.refund ?? inWindow) : inWindow;
    const outcome = await this.cancelInternal(b, dto.reason, refund);
    await this.notifications.notify(
      b.clientId,
      'BOOKING_CANCELED',
      `Your ${b.service.name} on ${when(b.startAt)} was canceled.`,
      id,
    );
    return { ...this.view(await this.visible(user, id), user), refund: outcome };
  }

  /**
   * `refund` outcome: `none` (nothing was paid or no refund is due), `manual` (paid in cash —
   * hand it back at the desk and set REFUNDED), `refunding` / `refunded` (online payment).
   */
  private async cancelInternal(
    b: { id: string; paymentStatus: PaymentStatus },
    reason: string | undefined,
    refund: boolean,
  ): Promise<'none' | 'manual' | 'refunding' | 'refunded' | 'failed'> {
    // Guarded: of two cancellations arriving together only one proceeds, so a refund starts once.
    const changed = await this.prisma.booking.updateMany({
      where: { id: b.id, status: BookingStatus.BOOKED },
      data: { status: BookingStatus.CANCELED, canceledAt: new Date(), cancelReason: reason?.trim() || null },
    });
    if (changed.count !== 1) throw conflict('This booking has just changed. Reload and try again.', 'NOT_CANCELABLE');
    await this.payments.cancelPending({ bookingId: b.id });
    if (b.paymentStatus !== PaymentStatus.PAID || !refund) return 'none';
    const result = await this.payments.refund({ bookingId: b.id });
    return result === 'none' ? 'manual' : result;
  }

  /** Used when an account is deactivated: every upcoming booking of the client is canceled. */
  async cancelUpcomingOfClient(clientId: string, reason: string) {
    const upcoming = await this.prisma.booking.findMany({
      where: { clientId, status: BookingStatus.BOOKED, startAt: { gt: new Date() } },
    });
    for (const b of upcoming) {
      const inWindow = b.startAt.getTime() - Date.now() >= CLIENT_CHANGE_WINDOW_HOURS * HOUR;
      // A booking that changed in the meantime (started, already canceled) is simply skipped.
      await this.cancelInternal(b, reason, inWindow).catch(() => undefined);
    }
    return upcoming.length;
  }

  // ---- Status and payment status --------------------------------------------------------------

  async setStatus(user: AuthUser, id: string, status: BookingStatus) {
    const b = await this.workable(user, id);
    if (TERMINAL.includes(b.status)) throw conflict(`A ${b.status} booking cannot change`, 'TERMINAL_STATUS');
    const now = Date.now();
    const start = b.startAt.getTime();

    if (status === BookingStatus.IN_PROGRESS) {
      if (b.status !== BookingStatus.BOOKED) throw conflict('This visit has already started', 'INVALID_TRANSITION');
      if (now < start - EARLY_START_MIN * MINUTE) {
        throw conflict(`A visit can be started at most ${EARLY_START_MIN} minutes early`, 'TOO_EARLY');
      }
    } else if (status === BookingStatus.NO_SHOW) {
      if (b.status !== BookingStatus.BOOKED) throw conflict('The client has already arrived', 'INVALID_TRANSITION');
      if (now < start + NO_SHOW_WAIT_MIN * MINUTE) {
        throw conflict(`Wait ${NO_SHOW_WAIT_MIN} minutes after the start before marking a no-show`, 'TOO_EARLY');
      }
      await this.payments.cancelPending({ bookingId: id });
    } else if (status === BookingStatus.COMPLETED) {
      if (b.status !== BookingStatus.IN_PROGRESS) throw conflict('Start the visit before completing it', 'INVALID_TRANSITION');
    } else {
      throw badRequest('Unsupported status');
    }
    // Guarded by the status that was checked above: a concurrent change loses cleanly.
    const changed = await this.prisma.booking.updateMany({ where: { id, status: b.status }, data: { status } });
    if (changed.count !== 1) throw conflict('This booking has just changed. Reload and try again.', 'INVALID_TRANSITION');
    const updated = await this.prisma.booking.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    return this.view(updated, user);
  }

  async setPaymentStatus(user: AuthUser, id: string, next: PaymentStatus) {
    const b = await this.visible(user, id);
    if (next === PaymentStatus.PAID && b.status === BookingStatus.CANCELED) {
      throw conflict('A canceled booking cannot be marked as paid', 'INVALID_TRANSITION');
    }
    const paymentStatus = await this.payments.manualChange({ bookingId: id }, b.paymentStatus, next);
    const updated = await this.prisma.booking.update({ where: { id }, data: { paymentStatus }, include: INCLUDE });
    return this.view(updated, user);
  }
}
