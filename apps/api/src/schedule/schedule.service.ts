import { Injectable, NotFoundException } from '@nestjs/common';
import { DayOfWeek, ExceptionType, Role } from '@prisma/client';
import { AuthUser, isAdmin } from '../common/auth-user';
import { badRequest, conflict, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import {
  addDays,
  ALL_DAYS,
  atLocal,
  BUFFER_MIN,
  dateFromDb,
  dateToDb,
  eachDate,
  fromMinutes,
  isValidDate,
  MINUTE,
  SHOP_TZ,
  timeFromDb,
  timeToDb,
  todayLocal,
  toMinutes,
} from '../common/time';
import { overlaps, Range } from './availability';
import { AvailabilityService } from './availability.service';
import { CreateExceptionDto, IntervalDto, RangeQuery, SlotCalendarQuery, SlotsQuery, WeekIntervalDto } from './schedule.dto';

const MAX_RANGE_DAYS = 62;

@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  /** "Barber own, Admin". Another barber's schedule is a 404, so its existence is not revealed. */
  async assertAccess(user: AuthUser, barberId: string) {
    const profile = await this.prisma.barberProfile.findUnique({ where: { id: barberId } });
    if (!profile) throw notFound('Barber');
    if (isAdmin(user)) return profile;
    if (user.role === Role.BARBER && user.barberId === barberId) return profile;
    throw notFound('Barber');
  }

  private range(q: RangeQuery, defaultDays = 30) {
    const from = q.from ?? todayLocal();
    const to = q.to ?? addDays(from, defaultDays);
    if (!isValidDate(from) || !isValidDate(to)) throw badRequest('Dates must be valid YYYY-MM-DD');
    if (to < from) throw badRequest('`to` must not be before `from`');
    if (to > addDays(from, MAX_RANGE_DAYS)) throw badRequest(`The range can span at most ${MAX_RANGE_DAYS} days`);
    return { from, to };
  }

  // ---- Weekly working hours ---------------------------------------------------------------

  async getWorkingHours(barberId: string) {
    const rows = await this.prisma.workingInterval.findMany({ where: { barberId }, orderBy: { startTime: 'asc' } });
    const days = Object.fromEntries(ALL_DAYS.map((d) => [d, [] as { startTime: string; endTime: string }[]])) as Record<
      DayOfWeek,
      { startTime: string; endTime: string }[]
    >;
    for (const r of rows) days[r.dayOfWeek].push({ startTime: timeFromDb(r.startTime), endTime: timeFromDb(r.endTime) });
    return { barberId, timezone: SHOP_TZ, days };
  }

  private toRanges(intervals: IntervalDto[], label: string): Range[] {
    const ranges = intervals.map((i) => ({ start: toMinutes(i.startTime), end: toMinutes(i.endTime) }));
    if (ranges.some((r) => r.start >= r.end)) throw badRequest(`${label}: each interval must end after it starts`);
    if (overlaps(ranges)) throw badRequest(`${label}: intervals must not overlap`);
    return ranges;
  }

  async replaceWeek(barberId: string, intervals: WeekIntervalDto[]) {
    const weekly = Object.fromEntries(
      ALL_DAYS.map((day) => [day, this.toRanges(intervals.filter((i) => i.dayOfWeek === day), day)]),
    ) as Record<DayOfWeek, Range[]>;
    await this.availability.assertNothingStranded(barberId, { weekly }, 'These hours');
    await this.prisma.$transaction([
      this.prisma.workingInterval.deleteMany({ where: { barberId } }),
      this.prisma.workingInterval.createMany({
        data: intervals.map((i) => ({
          barberId,
          dayOfWeek: i.dayOfWeek,
          startTime: timeToDb(i.startTime),
          endTime: timeToDb(i.endTime),
        })),
      }),
    ]);
    return this.getWorkingHours(barberId);
  }

  async replaceDay(barberId: string, dayOfWeek: string, intervals: IntervalDto[]) {
    const day = dayOfWeek.toUpperCase() as DayOfWeek;
    if (!ALL_DAYS.includes(day)) throw badRequest('dayOfWeek must be MONDAY … SUNDAY');
    const ranges = this.toRanges(intervals, day);
    await this.availability.assertNothingStranded(barberId, { weekly: { [day]: ranges } }, 'These hours');
    await this.prisma.$transaction([
      this.prisma.workingInterval.deleteMany({ where: { barberId, dayOfWeek: day } }),
      this.prisma.workingInterval.createMany({
        data: intervals.map((i) => ({
          barberId,
          dayOfWeek: day,
          startTime: timeToDb(i.startTime),
          endTime: timeToDb(i.endTime),
        })),
      }),
    ]);
    return this.getWorkingHours(barberId);
  }

  // ---- Exceptions -------------------------------------------------------------------------

  private exceptionView(e: {
    id: string;
    date: Date;
    type: ExceptionType;
    startTime: Date | null;
    endTime: Date | null;
    reason: string | null;
  }) {
    return {
      id: e.id,
      date: dateFromDb(e.date),
      type: e.type,
      startTime: e.startTime ? timeFromDb(e.startTime) : null,
      endTime: e.endTime ? timeFromDb(e.endTime) : null,
      reason: e.reason,
    };
  }

  async listExceptions(barberId: string, q: RangeQuery) {
    const from = q.from ?? todayLocal();
    const rows = await this.prisma.scheduleException.findMany({
      where: { barberId, date: { gte: dateToDb(from), ...(q.to ? { lte: dateToDb(q.to) } : {}) } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map((e) => this.exceptionView(e));
  }

  async createException(barberId: string, dto: CreateExceptionDto) {
    if (!isValidDate(dto.date)) throw badRequest('date must be a valid YYYY-MM-DD');
    if (dto.date < todayLocal()) throw badRequest('An exception cannot be created for a past date');
    if (!!dto.startTime !== !!dto.endTime) throw badRequest('Set both startTime and endTime, or neither for the whole day');
    const start = dto.startTime ? toMinutes(dto.startTime) : undefined;
    const end = dto.endTime ? toMinutes(dto.endTime) : undefined;
    if (start !== undefined && end !== undefined && start >= end) throw badRequest('endTime must be after startTime');
    if (dto.type === ExceptionType.ADDITIONAL && start === undefined) {
      throw badRequest('Extra working hours need a start and an end time');
    }
    if (dto.type === ExceptionType.BLOCKING) {
      await this.availability.assertNothingStranded(
        barberId,
        { addException: { date: dto.date, type: 'BLOCKING', start, end } },
        'This time off',
      );
    }
    const created = await this.prisma.scheduleException.create({
      data: {
        barberId,
        date: dateToDb(dto.date),
        type: dto.type,
        startTime: dto.startTime ? timeToDb(dto.startTime) : null,
        endTime: dto.endTime ? timeToDb(dto.endTime) : null,
        reason: dto.reason?.trim() || null,
      },
    });
    return this.exceptionView(created);
  }

  async deleteException(barberId: string, exceptionId: string) {
    const exception = await this.prisma.scheduleException.findFirst({ where: { id: exceptionId, barberId } });
    if (!exception) throw notFound('Exception');
    if (exception.type === ExceptionType.ADDITIONAL) {
      // Bookings made inside the extra hours would be left outside working time.
      await this.availability.assertNothingStranded(barberId, { removeExceptionId: exceptionId }, 'Removing these extra hours');
    }
    await this.prisma.scheduleException.delete({ where: { id: exceptionId } });
  }

  // ---- Resolved schedule ("View schedule" in roles.md) --------------------------------------

  async resolvedSchedule(barberId: string, q: RangeQuery) {
    const { from, to } = this.range(q, 6);
    const [available, exceptions] = await Promise.all([
      this.availability.calendar(barberId, from, to),
      this.listExceptions(barberId, { from, to }),
    ]);
    return {
      barberId,
      timezone: SHOP_TZ,
      days: eachDate(from, to).map((date) => ({
        date,
        hours: available(date).map((r) => ({ startTime: fromMinutes(r.start), endTime: fromMinutes(r.end) })),
        exceptions: exceptions.filter((e) => e.date === date),
      })),
    };
  }

  // ---- Slots ------------------------------------------------------------------------------

  private async offering(barberId: string, serviceId: string) {
    const offer = await this.prisma.barberService.findUnique({
      where: { barberId_serviceId: { barberId, serviceId } },
      include: { service: true, barber: { include: { user: true } } },
    });
    const live =
      offer && offer.service.isActive && offer.barber.user.isActive && offer.barber.user.role === Role.BARBER;
    if (!live) throw new NotFoundException('This barber does not offer this service');
    return offer;
  }

  async slots(barberId: string, q: SlotsQuery) {
    if (!isValidDate(q.date)) throw badRequest('date must be a valid YYYY-MM-DD');
    const offer = await this.offering(barberId, q.serviceId);
    const duration = offer.service.duration;
    const minutes = (await this.availability.slots(barberId, duration, q.date, q.date, q.excludeBookingId)).get(q.date)!;
    return {
      barberId,
      serviceId: q.serviceId,
      date: q.date,
      timezone: SHOP_TZ,
      duration,
      bufferMinutes: BUFFER_MIN,
      price: offer.price,
      slots: minutes.map((m) => {
        const startAt = atLocal(q.date, m);
        return {
          startAt,
          /** When the service itself ends; the buffer after it is not the client's time. */
          endAt: new Date(startAt.getTime() + duration * MINUTE),
          time: fromMinutes(m),
        };
      }),
    };
  }

  /** How many slots each day has — drives the date picker without one request per day. */
  async slotCalendar(barberId: string, q: SlotCalendarQuery) {
    const { from, to } = this.range(q);
    const offer = await this.offering(barberId, q.serviceId);
    const byDate = await this.availability.slots(barberId, offer.service.duration, from, to, q.excludeBookingId);
    return {
      barberId,
      serviceId: q.serviceId,
      timezone: SHOP_TZ,
      days: [...byDate.entries()].map(([date, slots]) => ({
        date,
        slotCount: slots.length,
        firstTime: slots.length ? fromMinutes(slots[0]) : null,
      })),
    };
  }
}

export { conflict };
