import { Injectable } from '@nestjs/common';
import { BookingStatus, DayOfWeek, ExceptionType } from '@prisma/client';
import { badRequest, conflict } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import {
  addDays,
  atLocal,
  BUFFER_MIN,
  dateFromDb,
  dateToDb,
  dayOfWeekOf,
  endOfLocalDay,
  localDateOf,
  localMinutesOf,
  MAX_DAYS_AHEAD,
  MINUTE,
  SLOT_STEP_MIN,
  startOfLocalDay,
  timeFromDb,
  todayLocal,
  toMinutes,
} from '../common/time';
import { computeSlots, dayAvailability, DayException, fitsAvailability, Range } from './availability';

/** Hypothetical changes to a barber's schedule, used to test an edit before saving it. */
export interface ScheduleOverride {
  /** Days present here replace the stored weekly intervals of that day. */
  weekly?: Partial<Record<DayOfWeek, Range[]>>;
  addException?: { date: string } & DayException;
  removeExceptionId?: string;
}

const ACTIVE: BookingStatus[] = [BookingStatus.BOOKED, BookingStatus.IN_PROGRESS];

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns a function giving the barber's available hours on any date in [from, to]. */
  async calendar(barberId: string, from: string, to: string, override: ScheduleOverride = {}) {
    const [intervals, exceptions] = await Promise.all([
      this.prisma.workingInterval.findMany({ where: { barberId } }),
      this.prisma.scheduleException.findMany({
        where: { barberId, date: { gte: dateToDb(from), lte: dateToDb(to) } },
      }),
    ]);

    const weekly = new Map<DayOfWeek, Range[]>();
    for (const i of intervals) {
      const list = weekly.get(i.dayOfWeek) ?? [];
      list.push({ start: toMinutes(timeFromDb(i.startTime)), end: toMinutes(timeFromDb(i.endTime)) });
      weekly.set(i.dayOfWeek, list);
    }
    for (const [day, ranges] of Object.entries(override.weekly ?? {})) {
      weekly.set(day as DayOfWeek, ranges ?? []);
    }

    const byDate = new Map<string, DayException[]>();
    const push = (date: string, e: DayException) => byDate.set(date, [...(byDate.get(date) ?? []), e]);
    for (const e of exceptions) {
      if (e.id === override.removeExceptionId) continue;
      push(dateFromDb(e.date), {
        type: e.type,
        start: e.startTime ? toMinutes(timeFromDb(e.startTime)) : undefined,
        end: e.endTime ? toMinutes(timeFromDb(e.endTime)) : undefined,
      });
    }
    if (override.addException) {
      const { date, ...e } = override.addException;
      push(date, e);
    }

    return (date: string): Range[] => dayAvailability(weekly.get(dayOfWeekOf(date)) ?? [], byDate.get(date) ?? []);
  }

  /** Non-canceled bookings of a barber that touch [from, to), as moments including their buffer. */
  private async busy(barberId: string, from: Date, to: Date, excludeBookingId?: string) {
    const bookings = await this.prisma.booking.findMany({
      where: {
        barberId,
        status: { not: BookingStatus.CANCELED },
        startAt: { lt: to },
        endAt: { gt: from },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      select: { startAt: true, endAt: true },
    });
    return bookings.map((b) => ({ start: b.startAt.getTime(), end: b.endAt.getTime() }));
  }

  /** Bookable start times, in minutes since local midnight, for each date in [from, to]. */
  async slots(barberId: string, duration: number, from: string, to: string, excludeBookingId?: string) {
    const now = Date.now();
    const [available, busy] = await Promise.all([
      this.calendar(barberId, from, to),
      this.busy(barberId, startOfLocalDay(from), endOfLocalDay(to), excludeBookingId),
    ]);
    const notAfter = endOfLocalDay(addDays(todayLocal(), MAX_DAYS_AHEAD)).getTime() - 1;
    const result = new Map<string, number[]>();
    for (let date = from; date <= to; date = addDays(date, 1)) {
      result.set(
        date,
        computeSlots({
          available: available(date),
          busy,
          duration,
          buffer: BUFFER_MIN,
          step: SLOT_STEP_MIN,
          toInstant: (m) => atLocal(date, m).getTime(),
          notBefore: now,
          notAfter,
        }),
      );
    }
    return result;
  }

  /**
   * Every rule a booking time must satisfy (domain §4.4): on the 15-minute grid, not in the
   * past, at most 30 days ahead, inside the barber's hours, and clear of other bookings.
   * The database exclusion constraint is still the final guard against a race.
   */
  async assertBookable(barberId: string, startAt: Date, duration: number, excludeBookingId?: string) {
    if (Number.isNaN(startAt.getTime())) throw badRequest('startAt is not a valid moment');
    if (startAt.getTime() % (SLOT_STEP_MIN * MINUTE) !== 0) {
      throw badRequest('Bookings start on a 15-minute step');
    }
    if (startAt.getTime() <= Date.now()) throw conflict('This time is already in the past', 'IN_THE_PAST');
    const date = localDateOf(startAt);
    if (date > addDays(todayLocal(), MAX_DAYS_AHEAD)) {
      throw conflict(`Bookings open ${MAX_DAYS_AHEAD} days ahead`, 'TOO_FAR_AHEAD');
    }
    const available = (await this.calendar(barberId, date, date))(date);
    if (!fitsAvailability(available, localMinutesOf(startAt), duration)) {
      throw conflict('The barber is not working at this time', 'OUTSIDE_HOURS');
    }
    const end = new Date(startAt.getTime() + (duration + BUFFER_MIN) * MINUTE);
    const busy = await this.busy(barberId, startAt, end, excludeBookingId);
    if (busy.length) throw conflict('This time has just been taken. Please pick another slot.', 'SLOT_TAKEN');
  }

  /**
   * Upcoming bookings that a schedule change would leave outside the barber's hours.
   * A change that strands bookings is refused: they must be moved or canceled first.
   */
  async strandedBookings(barberId: string, override: ScheduleOverride) {
    const bookings = await this.prisma.booking.findMany({
      where: { barberId, status: { in: ACTIVE }, startAt: { gte: new Date() } },
      orderBy: { startAt: 'asc' },
      select: {
        id: true,
        startAt: true,
        durationSnapshot: true,
        client: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
      },
    });
    if (!bookings.length) return [];
    const from = localDateOf(bookings[0].startAt);
    const to = localDateOf(bookings[bookings.length - 1].startAt);
    const available = await this.calendar(barberId, from, to, override);
    return bookings
      .filter((b) => !fitsAvailability(available(localDateOf(b.startAt)), localMinutesOf(b.startAt), b.durationSnapshot))
      .map((b) => ({
        id: b.id,
        startAt: b.startAt,
        service: b.service.name,
        client: [b.client.firstName, b.client.lastName].filter(Boolean).join(' '),
      }));
  }

  async assertNothingStranded(barberId: string, override: ScheduleOverride, what: string) {
    const stranded = await this.strandedBookings(barberId, override);
    if (stranded.length) {
      throw conflict(
        `${what} would leave ${stranded.length} upcoming booking${stranded.length > 1 ? 's' : ''} outside working hours. Move or cancel ${stranded.length > 1 ? 'them' : 'it'} first.`,
        'BOOKINGS_IN_THE_WAY',
        { bookings: stranded },
      );
    }
  }
}

export { ExceptionType };
