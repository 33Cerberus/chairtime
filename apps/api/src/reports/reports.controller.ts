import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BookingStatus, OrderStatus, PaymentStatus, Role } from '@prisma/client';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { DateTime } from 'luxon';
import { Roles } from '../common/auth-user';
import { badRequest } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import {
  addDays,
  eachDate,
  endOfLocalDay,
  ISO_DATE,
  isValidDate,
  SHOP_TZ,
  startOfLocalDay,
  todayLocal,
} from '../common/time';
import { AvailabilityService } from '../schedule/availability.service';

class ReportQuery {
  /** Local date, inclusive. Defaults to 29 days before `to`. */
  @IsOptional() @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  /** Local date, inclusive. Defaults to today. */
  @IsOptional() @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

class RevenueQuery extends ReportQuery {
  @IsOptional() @IsIn(['day', 'week', 'month'])
  groupBy?: 'day' | 'week' | 'month';
}

const MAX_DAYS = 400;
const OCCUPYING: BookingStatus[] = [BookingStatus.BOOKED, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED];

/**
 * Owner analytics. Revenue is money actually taken: bookings and orders whose payment
 * status is PAID, attributed to the visit date (bookings) or the order date (orders).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  private range(q: ReportQuery) {
    const to = q.to ?? todayLocal();
    const from = q.from ?? addDays(to, -29);
    if (!isValidDate(from) || !isValidDate(to)) throw badRequest('Dates must be valid YYYY-MM-DD');
    if (to < from) throw badRequest('`to` must not be before `from`');
    const days = eachDate(from, to).length;
    if (days > MAX_DAYS) throw badRequest(`A report can span at most ${MAX_DAYS} days`);
    return { from, to, days, start: startOfLocalDay(from), end: endOfLocalDay(to) };
  }

  private async totals(start: Date, end: Date) {
    const [byStatus, bookingRevenue, orderRevenue, orders, newClients] = await Promise.all([
      this.prisma.booking.groupBy({ by: ['status'], where: { startAt: { gte: start, lt: end } }, _count: true }),
      this.prisma.booking.aggregate({
        where: { startAt: { gte: start, lt: end }, paymentStatus: PaymentStatus.PAID },
        _sum: { priceSnapshot: true },
        _count: true,
      }),
      this.prisma.order.aggregate({
        where: { createdAt: { gte: start, lt: end }, paymentStatus: PaymentStatus.PAID },
        _sum: { totalPrice: true },
      }),
      this.prisma.order.count({ where: { createdAt: { gte: start, lt: end }, status: { not: OrderStatus.CANCELED } } }),
      this.prisma.user.count({ where: { role: Role.CLIENT, createdAt: { gte: start, lt: end } } }),
    ]);
    const count = (s: BookingStatus) => byStatus.find((r) => r.status === s)?._count ?? 0;
    const bookings = byStatus.reduce((n, r) => n + r._count, 0);
    const completed = count(BookingStatus.COMPLETED);
    const noShow = count(BookingStatus.NO_SHOW);
    const canceled = count(BookingStatus.CANCELED);
    const serviceRevenue = bookingRevenue._sum.priceSnapshot ?? 0;
    const productRevenue = orderRevenue._sum.totalPrice ?? 0;
    return {
      revenue: serviceRevenue + productRevenue,
      serviceRevenue,
      productRevenue,
      bookings,
      completed,
      upcoming: count(BookingStatus.BOOKED) + count(BookingStatus.IN_PROGRESS),
      canceled,
      noShow,
      /** Share of finished visits where the client did not arrive. */
      noShowRate: completed + noShow ? noShow / (completed + noShow) : 0,
      cancelRate: bookings ? canceled / bookings : 0,
      averageTicket: bookingRevenue._count ? Math.round(serviceRevenue / bookingRevenue._count) : 0,
      orders,
      newClients,
    };
  }

  /** Headline numbers, with the same numbers for the period of equal length just before. */
  async summary(q: ReportQuery) {
    const r = this.range(q);
    const previousTo = addDays(r.from, -1);
    const previousFrom = addDays(previousTo, -(r.days - 1));
    const [current, previous] = await Promise.all([
      this.totals(r.start, r.end),
      this.totals(startOfLocalDay(previousFrom), endOfLocalDay(previousTo)),
    ]);
    return { from: r.from, to: r.to, current, previous: { from: previousFrom, to: previousTo, ...previous } };
  }

  async revenue(q: RevenueQuery) {
    const r = this.range(q);
    const groupBy = q.groupBy ?? (r.days > 120 ? 'month' : r.days > 45 ? 'week' : 'day');
    const bucketOf = (d: Date | string) => {
      const dt = typeof d === 'string' ? DateTime.fromISO(d, { zone: SHOP_TZ }) : DateTime.fromJSDate(d, { zone: SHOP_TZ });
      return dt.startOf(groupBy).toISODate()!;
    };
    const [bookings, orders] = await Promise.all([
      this.prisma.booking.findMany({
        where: { startAt: { gte: r.start, lt: r.end }, paymentStatus: PaymentStatus.PAID },
        select: { startAt: true, priceSnapshot: true },
      }),
      this.prisma.order.findMany({
        where: { createdAt: { gte: r.start, lt: r.end }, paymentStatus: PaymentStatus.PAID },
        select: { createdAt: true, totalPrice: true },
      }),
    ]);
    const buckets = new Map<string, { period: string; services: number; products: number; total: number; visits: number }>();
    for (const date of eachDate(r.from, r.to)) {
      const key = bucketOf(date);
      if (!buckets.has(key)) buckets.set(key, { period: key, services: 0, products: 0, total: 0, visits: 0 });
    }
    for (const b of bookings) {
      const bucket = buckets.get(bucketOf(b.startAt));
      if (bucket) {
        bucket.services += b.priceSnapshot;
        bucket.total += b.priceSnapshot;
        bucket.visits += 1;
      }
    }
    for (const o of orders) {
      const bucket = buckets.get(bucketOf(o.createdAt));
      if (bucket) {
        bucket.products += o.totalPrice;
        bucket.total += o.totalPrice;
      }
    }
    return { from: r.from, to: r.to, groupBy, series: [...buckets.values()] };
  }

  /**
   * Utilisation = booked service minutes ÷ minutes the barber was available, over the period.
   * Buffers are not counted as booked time.
   */
  async barbers(q: ReportQuery) {
    const r = this.range(q);
    const profiles = await this.prisma.barberProfile.findMany({
      include: { user: { select: { firstName: true, lastName: true, isActive: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const dates = eachDate(r.from, r.to);
    const rows = await Promise.all(
      profiles.map(async (p) => {
        const [available, bookings] = await Promise.all([
          this.availability.calendar(p.id, r.from, r.to),
          this.prisma.booking.findMany({
            where: { barberId: p.id, startAt: { gte: r.start, lt: r.end } },
            select: { status: true, paymentStatus: true, priceSnapshot: true, durationSnapshot: true },
          }),
        ]);
        const availableMinutes = dates.reduce(
          (sum, d) => sum + available(d).reduce((n, range) => n + (range.end - range.start), 0),
          0,
        );
        const occupying = bookings.filter((b) => OCCUPYING.includes(b.status));
        const bookedMinutes = occupying.reduce((n, b) => n + b.durationSnapshot, 0);
        return {
          barberId: p.id,
          firstName: p.user.firstName,
          lastName: p.user.lastName,
          photoUrl: p.photoUrl,
          isActive: p.user.isActive && p.user.role === Role.BARBER,
          bookings: occupying.length,
          completed: bookings.filter((b) => b.status === BookingStatus.COMPLETED).length,
          noShow: bookings.filter((b) => b.status === BookingStatus.NO_SHOW).length,
          revenue: bookings.filter((b) => b.paymentStatus === PaymentStatus.PAID).reduce((n, b) => n + b.priceSnapshot, 0),
          bookedMinutes,
          availableMinutes,
          utilisation: availableMinutes ? Math.min(1, bookedMinutes / availableMinutes) : 0,
        };
      }),
    );
    return {
      from: r.from,
      to: r.to,
      barbers: rows.filter((b) => b.isActive || b.bookings > 0).sort((a, b) => b.revenue - a.revenue),
    };
  }

  async services(q: ReportQuery) {
    const r = this.range(q);
    const [grouped, services] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['serviceId'],
        where: { startAt: { gte: r.start, lt: r.end }, status: { in: OCCUPYING } },
        _count: true,
        _sum: { priceSnapshot: true },
      }),
      this.prisma.service.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      from: r.from,
      to: r.to,
      services: grouped
        .map((g) => ({
          serviceId: g.serviceId,
          name: services.find((s) => s.id === g.serviceId)?.name ?? 'Unknown',
          bookings: g._count,
          value: g._sum.priceSnapshot ?? 0,
        }))
        .sort((a, b) => b.bookings - a.bookings),
    };
  }

  async products(q: ReportQuery) {
    const r = this.range(q);
    const items = await this.prisma.orderItem.findMany({
      where: { order: { createdAt: { gte: r.start, lt: r.end }, status: { not: OrderStatus.CANCELED } } },
      select: { productId: true, quantity: true, priceSnapshot: true, product: { select: { name: true, stock: true } } },
    });
    const byProduct = new Map<string, { productId: string; name: string; stock: number; units: number; value: number }>();
    for (const i of items) {
      const row = byProduct.get(i.productId) ?? { productId: i.productId, name: i.product.name, stock: i.product.stock, units: 0, value: 0 };
      row.units += i.quantity;
      row.value += i.quantity * i.priceSnapshot;
      byProduct.set(i.productId, row);
    }
    return { from: r.from, to: r.to, products: [...byProduct.values()].sort((a, b) => b.units - a.units) };
  }
}

@ApiTags('Reports')
@ApiBearerAuth()
@Roles(Role.OWNER)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Headline numbers for a period, compared with the previous period' })
  summary(@Query() q: ReportQuery) {
    return this.reports.summary(q);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Revenue by period, split into services and products' })
  revenue(@Query() q: RevenueQuery) {
    return this.reports.revenue(q);
  }

  @Get('barbers')
  @ApiOperation({ summary: 'Per barber: visits, revenue and utilisation' })
  barbers(@Query() q: ReportQuery) {
    return this.reports.barbers(q);
  }

  @Get('services')
  @ApiOperation({ summary: 'Most booked services' })
  services(@Query() q: ReportQuery) {
    return this.reports.services(q);
  }

  @Get('products')
  @ApiOperation({ summary: 'Best selling products' })
  products(@Query() q: ReportQuery) {
    return this.reports.products(q);
  }
}
