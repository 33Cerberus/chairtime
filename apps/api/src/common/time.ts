import { DayOfWeek } from '@prisma/client';
import { DateTime } from 'luxon';

export const SHOP_TZ = process.env.SHOP_TIMEZONE || 'Europe/Warsaw';

/** Business constants from docs/domain.md §4.4. */
export const SLOT_STEP_MIN = 15;
export const BUFFER_MIN = 15;
export const MAX_DAYS_AHEAD = 30;
export const CLIENT_CHANGE_WINDOW_HOURS = 2;
export const NO_SHOW_WAIT_MIN = 15;
/** A visit can be started a little early, when the client arrives ahead of time. */
export const EARLY_START_MIN = 30;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const ALL_DAYS: DayOfWeek[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "10:30" -> 630 */
export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** 630 -> "10:30" */
export const fromMinutes = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Prisma maps `time` columns to a Date on 1970-01-01 UTC. */
export const timeToDb = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
export const timeFromDb = (d: Date) => d.toISOString().slice(11, 16);

/** Prisma maps `date` columns to a Date at UTC midnight. */
export const dateToDb = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const dateFromDb = (d: Date) => d.toISOString().slice(0, 10);

/** Local calendar date (shop time) of a moment. */
export const localDateOf = (instant: Date) => DateTime.fromJSDate(instant, { zone: SHOP_TZ }).toISODate()!;

/** Minutes since local midnight (shop time) of a moment. */
export const localMinutesOf = (instant: Date) => {
  const dt = DateTime.fromJSDate(instant, { zone: SHOP_TZ });
  return dt.hour * 60 + dt.minute;
};

export const todayLocal = () => localDateOf(new Date());

export const dayOfWeekOf = (isoDate: string): DayOfWeek =>
  ALL_DAYS[DateTime.fromISO(isoDate, { zone: SHOP_TZ }).weekday - 1];

/** The moment that a local wall-clock time on a local date corresponds to. */
export const atLocal = (isoDate: string, minutes: number): Date => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return DateTime.fromObject(
    { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
    { zone: SHOP_TZ },
  ).toJSDate();
};

export const startOfLocalDay = (isoDate: string) => atLocal(isoDate, 0);
export const endOfLocalDay = (isoDate: string) =>
  DateTime.fromISO(isoDate, { zone: SHOP_TZ }).plus({ days: 1 }).startOf('day').toJSDate();

export const addDays = (isoDate: string, days: number) =>
  DateTime.fromISO(isoDate, { zone: SHOP_TZ }).plus({ days }).toISODate()!;

/** Inclusive list of local dates. */
export const eachDate = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

export const isValidDate = (iso: string) => ISO_DATE.test(iso) && DateTime.fromISO(iso).isValid;
