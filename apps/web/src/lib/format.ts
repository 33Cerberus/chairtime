/** Formatting. Every moment is shown in shop time, wherever the visitor's device thinks it is. */

export const SHOP_TZ = 'Europe/Warsaw';
const LOCALE = 'en-GB';

/** 8500 -> "85 zł", 8550 -> "85.50 zł" */
export const money = (grosze: number) =>
  `${(grosze / 100).toLocaleString(LOCALE, {
    minimumFractionDigits: grosze % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })} zł`;

export const duration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
};

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE, { timeZone: SHOP_TZ, ...o });
const TIME = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DAY = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const DAY_LONG = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const DATE = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const ISO = new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

const d = (v: string | Date) => (typeof v === 'string' ? new Date(v) : v);

export const time = (v: string | Date) => TIME.format(d(v));
export const day = (v: string | Date) => DAY.format(d(v));
export const dayLong = (v: string | Date) => DAY_LONG.format(d(v));
export const date = (v: string | Date) => DATE.format(d(v));
export const dateTime = (v: string | Date) => `${day(v)}, ${time(v)}`;

/** Local calendar date in shop time, as YYYY-MM-DD. */
export const isoDate = (v: string | Date = new Date()) => ISO.format(d(v));

/** Minutes since local midnight in shop time. */
export const minutesOfDay = (v: string | Date) => {
  const [h, m] = time(v).split(':').map(Number);
  return h * 60 + m;
};

/** The moment that a wall-clock time on a shop-local date corresponds to. */
export const zonedTime = (iso: string, minutes = 0) => {
  const wanted = new Date(`${iso}T00:00:00Z`).getTime() + minutes * 60_000;
  let guess = wanted;
  // Two passes settle the offset, including on daylight-saving days.
  for (let i = 0; i < 2; i++) {
    const shown = new Date(`${isoDate(new Date(guess))}T${time(new Date(guess))}:00Z`).getTime();
    guess += wanted - shown;
  }
  return new Date(guess);
};

// Calendar-date arithmetic is done at UTC noon, so daylight saving never shifts a day.
const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);
export const addDays = (iso: string, n: number) => new Date(noon(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const eachDay = (from: string, count: number) => Array.from({ length: count }, (_, i) => addDays(from, i));

const utc = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', ...o });
export const weekdayShort = (iso: string) => utc({ weekday: 'short' }).format(noon(iso));
export const weekdayLong = (iso: string) => utc({ weekday: 'long' }).format(noon(iso));
export const dayOfMonth = (iso: string) => utc({ day: 'numeric' }).format(noon(iso));
export const monthShort = (iso: string) => utc({ month: 'short' }).format(noon(iso));
export const monthLong = (iso: string) => utc({ month: 'long', year: 'numeric' }).format(noon(iso));
export const isoDay = (iso: string) => utc({ weekday: 'short', day: 'numeric', month: 'short' }).format(noon(iso));
export const isoDayLong = (iso: string) => utc({ weekday: 'long', day: 'numeric', month: 'long' }).format(noon(iso));

/** Monday of the week containing the date. */
export const startOfWeek = (iso: string) => addDays(iso, -((noon(iso).getUTCDay() + 6) % 7));

export const relativeDay = (iso: string) => {
  const today = isoDate();
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  return isoDay(iso);
};

export const fullName = (p: { firstName: string; lastName?: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ');

export const initials = (p: { firstName: string; lastName?: string | null }) =>
  `${p.firstName[0] ?? ''}${p.lastName?.[0] ?? ''}`.toUpperCase();

/** +48600100200 -> "+48 600 100 200" */
export const phone = (v: string) =>
  v.startsWith('+48') && v.length === 12 ? `+48 ${v.slice(3, 6)} ${v.slice(6, 9)} ${v.slice(9)}` : v;

export const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
