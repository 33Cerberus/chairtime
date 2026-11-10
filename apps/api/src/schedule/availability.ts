/**
 * Pure scheduling maths. No database, no clock, no time zone — everything here works on
 * minutes since local midnight, and callers translate to moments.
 */

/** A half-open range of minutes since local midnight: [start, end). */
export interface Range {
  start: number;
  end: number;
}

export interface DayException {
  type: 'BLOCKING' | 'ADDITIONAL';
  /** Both undefined = whole day. */
  start?: number;
  end?: number;
}

const DAY: Range = { start: 0, end: 24 * 60 };

/** Sorts and merges overlapping or touching ranges. */
export function normalize(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export function subtract(ranges: Range[], cut: Range): Range[] {
  const out: Range[] = [];
  for (const r of ranges) {
    if (cut.end <= r.start || cut.start >= r.end) {
      out.push(r);
      continue;
    }
    if (cut.start > r.start) out.push({ start: r.start, end: cut.start });
    if (cut.end < r.end) out.push({ start: cut.end, end: r.end });
  }
  return out;
}

export const overlaps = (ranges: Range[]) => {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  return sorted.some((r, i) => i > 0 && r.start < sorted[i - 1].end);
};

/**
 * Hours a barber is available on one date:
 * weekly intervals, minus blocking exceptions, plus additional ones.
 */
export function dayAvailability(weekly: Range[], exceptions: DayException[]): Range[] {
  let ranges = normalize(weekly);
  for (const e of exceptions) {
    if (e.type !== 'BLOCKING') continue;
    ranges = subtract(ranges, e.start === undefined || e.end === undefined ? DAY : { start: e.start, end: e.end });
  }
  for (const e of exceptions) {
    if (e.type === 'ADDITIONAL' && e.start !== undefined && e.end !== undefined) {
      ranges.push({ start: e.start, end: e.end });
    }
  }
  return normalize(ranges);
}

/** True when the service itself — [start, start + duration) — lies inside the available hours. */
export function fitsAvailability(available: Range[], start: number, duration: number) {
  return available.some((r) => start >= r.start && start + duration <= r.end);
}

export interface SlotInput {
  available: Range[];
  /** Existing bookings as moments (ms), each already including its buffer. */
  busy: { start: number; end: number }[];
  duration: number;
  buffer: number;
  step: number;
  /** Translates minutes since local midnight on the requested date to a moment (ms). */
  toInstant: (minutes: number) => number;
  /** Earliest and latest allowed start, as moments (ms). */
  notBefore: number;
  notAfter: number;
}

/**
 * Start times (minutes since local midnight) that can be booked.
 *
 * The service must fit inside the available hours. The 15-minute buffer after it may run
 * past the end of the working interval (cleaning up after closing time), but it must never
 * overlap another booking.
 */
export function computeSlots(input: SlotInput): number[] {
  const { available, busy, duration, buffer, step, toInstant, notBefore, notAfter } = input;
  const out: number[] = [];
  for (const range of available) {
    const first = Math.ceil(range.start / step) * step;
    for (let m = first; m + duration <= range.end; m += step) {
      const start = toInstant(m);
      if (start < notBefore || start > notAfter) continue;
      const end = start + (duration + buffer) * 60_000;
      if (busy.some((b) => start < b.end && end > b.start)) continue;
      out.push(m);
    }
  }
  return out;
}
