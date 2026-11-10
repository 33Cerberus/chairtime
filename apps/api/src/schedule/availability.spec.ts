import { describe, expect, it } from 'vitest';
import { computeSlots, dayAvailability, fitsAvailability, normalize, overlaps, subtract } from './availability';

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const MIN = 60_000;
/** Pretend local midnight is moment 0, so minutes map straight to milliseconds. */
const toInstant = (m: number) => m * MIN;

const slots = (over: Partial<Parameters<typeof computeSlots>[0]> = {}) =>
  computeSlots({
    available: [{ start: h(10), end: h(14) }],
    busy: [],
    duration: 45,
    buffer: 15,
    step: 15,
    toInstant,
    notBefore: 0,
    notAfter: Number.MAX_SAFE_INTEGER,
    ...over,
  });

describe('normalize', () => {
  it('merges overlapping and touching ranges and drops empty ones', () => {
    expect(
      normalize([
        { start: h(15), end: h(19) },
        { start: h(10), end: h(14) },
        { start: h(14), end: h(15) },
        { start: h(20), end: h(20) },
      ]),
    ).toEqual([{ start: h(10), end: h(19) }]);
  });
});

describe('subtract', () => {
  it('splits a range around the cut', () => {
    expect(subtract([{ start: h(10), end: h(19) }], { start: h(13), end: h(14) })).toEqual([
      { start: h(10), end: h(13) },
      { start: h(14), end: h(19) },
    ]);
  });
});

describe('overlaps', () => {
  it('treats touching intervals as fine and overlapping ones as an error', () => {
    expect(overlaps([{ start: h(10), end: h(14) }, { start: h(14), end: h(18) }])).toBe(false);
    expect(overlaps([{ start: h(10), end: h(14) }, { start: h(13), end: h(18) }])).toBe(true);
  });
});

describe('dayAvailability', () => {
  const weekly = [
    { start: h(10), end: h(14) },
    { start: h(15), end: h(19) },
  ];

  it('is the weekly schedule when there are no exceptions; lunch is just the gap', () => {
    expect(dayAvailability(weekly, [])).toEqual(weekly);
  });

  it('a whole-day blocking exception empties the day', () => {
    expect(dayAvailability(weekly, [{ type: 'BLOCKING' }])).toEqual([]);
  });

  it('a partial blocking exception cuts hours out', () => {
    expect(dayAvailability(weekly, [{ type: 'BLOCKING', start: h(12), end: h(16) }])).toEqual([
      { start: h(10), end: h(12) },
      { start: h(16), end: h(19) },
    ]);
  });

  it('an additional exception adds hours, even on a day off', () => {
    expect(dayAvailability([], [{ type: 'ADDITIONAL', start: h(10), end: h(13) }])).toEqual([{ start: h(10), end: h(13) }]);
  });

  it('applies blocking first, then additional: (weekly - blocking) + additional', () => {
    expect(
      dayAvailability(weekly, [
        { type: 'ADDITIONAL', start: h(11), end: h(12) },
        { type: 'BLOCKING' },
      ]),
    ).toEqual([{ start: h(11), end: h(12) }]);
  });

  it('additional hours that touch the weekly hours merge with them', () => {
    expect(dayAvailability(weekly, [{ type: 'ADDITIONAL', start: h(14), end: h(15) }])).toEqual([{ start: h(10), end: h(19) }]);
  });
});

describe('computeSlots', () => {
  it('offers 15-minute steps while the service fits inside the hours', () => {
    const result = slots();
    expect(result[0]).toBe(h(10));
    expect(result[1]).toBe(h(10, 15));
    // 45 minutes must end by 14:00, so the last start is 13:15. The buffer may run past closing.
    expect(result[result.length - 1]).toBe(h(13, 15));
  });

  it('never starts a service that would run past the end of the interval', () => {
    expect(slots({ duration: 60 }).every((m) => m + 60 <= h(14))).toBe(true);
  });

  it('snaps to the quarter-hour grid when the interval starts off-grid', () => {
    expect(slots({ available: [{ start: h(10, 5), end: h(12) }] })[0]).toBe(h(10, 15));
  });

  it('keeps the buffer free after an existing booking', () => {
    // Existing 45-minute booking at 11:00 occupies 11:00–12:00 including its buffer.
    const busy = [{ start: toInstant(h(11)), end: toInstant(h(12)) }];
    const result = slots({ busy });
    // A new 45-minute visit needs 60 minutes clear: the last start before it is 10:00.
    expect(result).toContain(h(10));
    expect(result).not.toContain(h(10, 15));
    expect(result).not.toContain(h(11, 45));
    // And the next one can begin exactly when the buffer ends.
    expect(result).toContain(h(12));
  });

  it('does not offer times in the past', () => {
    expect(slots({ notBefore: toInstant(h(12, 5)) })[0]).toBe(h(12, 15));
  });

  it('does not offer times beyond the booking horizon', () => {
    expect(slots({ notAfter: toInstant(h(9)) })).toEqual([]);
  });

  it('does not let a service span the lunch gap', () => {
    const result = slots({
      available: [
        { start: h(10), end: h(14) },
        { start: h(15), end: h(19) },
      ],
      duration: 75,
    });
    expect(result).toContain(h(12, 45));
    expect(result).not.toContain(h(13));
    expect(result).toContain(h(15));
  });
});

describe('fitsAvailability', () => {
  const available = [{ start: h(10), end: h(14) }];

  it('accepts a service that ends exactly at closing', () => {
    expect(fitsAvailability(available, h(13, 15), 45)).toBe(true);
  });

  it('rejects a service that starts before opening or ends after closing', () => {
    expect(fitsAvailability(available, h(9, 45), 45)).toBe(false);
    expect(fitsAvailability(available, h(13, 30), 45)).toBe(false);
  });
});
