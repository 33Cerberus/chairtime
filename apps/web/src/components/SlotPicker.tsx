import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarX2 } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { api, Slot, SlotCalendar, SlotsResponse } from '../lib/api';
import { addDays, dayOfMonth, isoDate, isoDayLong, monthLong, weekdayShort } from '../lib/format';
import { cn, IconButton, Skeleton } from './ui';

const HORIZON_DAYS = 30;

interface Props {
  barberId: string;
  serviceId: string;
  date: string;
  onDateChange: (date: string) => void;
  value: Slot | null;
  onChange: (slot: Slot | null) => void;
  /** When moving a booking, its own time counts as free. */
  excludeBookingId?: string;
}

const PARTS: [label: string, from: number, to: number][] = [
  ['Morning', 0, 12],
  ['Afternoon', 12, 17],
  ['Evening', 17, 24],
];

/** Date strip plus time grid. Days without free slots are shown but cannot be picked. */
export function SlotPicker({ barberId, serviceId, date, onDateChange, value, onChange, excludeBookingId }: Props) {
  const today = isoDate();
  const last = addDays(today, HORIZON_DAYS);
  const strip = useRef<HTMLDivElement>(null);

  const calendar = useQuery({
    queryKey: ['slot-calendar', barberId, serviceId, today, excludeBookingId],
    queryFn: () =>
      api<SlotCalendar>(`/barbers/${barberId}/slots/calendar`, { query: { serviceId, from: today, to: last, excludeBookingId } }),
  });
  const slots = useQuery({
    queryKey: ['slots', barberId, serviceId, date, excludeBookingId],
    queryFn: () => api<SlotsResponse>(`/barbers/${barberId}/slots`, { query: { serviceId, date, excludeBookingId } }),
    // Someone else may take a slot while this page is open.
    refetchInterval: 60_000,
  });

  // Jump to the first day that actually has a free slot.
  const firstFree = calendar.data?.days.find((d) => d.slotCount > 0)?.date;
  const counts = useMemo(() => new Map(calendar.data?.days.map((d) => [d.date, d.slotCount])), [calendar.data]);
  useEffect(() => {
    if (firstFree && counts.get(date) === 0) onDateChange(firstFree);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstFree]);

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [date]);

  const days = calendar.data?.days ?? [];
  const scroll = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  const groups = PARTS.map(([label, from, to]) => ({
    label,
    slots: (slots.data?.slots ?? []).filter((s) => {
      const hour = Number(s.time.slice(0, 2));
      return hour >= from && hour < to;
    }),
  })).filter((g) => g.slots.length);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="display text-2xl text-ink-950">{monthLong(date)}</p>
        <div className="flex gap-1">
          <IconButton label="Earlier dates" onClick={() => scroll(-1)}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <IconButton label="Later dates" onClick={() => scroll(1)}>
            <ChevronRight className="size-5" />
          </IconButton>
        </div>
      </div>

      <div
        ref={strip}
        className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="listbox"
        aria-label="Date"
      >
        {calendar.isLoading
          ? Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[76px] w-[62px] shrink-0 !rounded-2xl" />)
          : days.map((d) => {
              const selected = d.date === date;
              const empty = d.slotCount === 0;
              return (
                <button
                  key={d.date}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={`${isoDayLong(d.date)}${empty ? ', fully booked' : `, ${d.slotCount} time${d.slotCount === 1 ? "" : "s"} free`}`}
                  data-date={d.date}
                  disabled={empty}
                  onClick={() => {
                    onDateChange(d.date);
                    onChange(null);
                  }}
                  className={cn(
                    'flex h-[76px] w-[62px] shrink-0 snap-start flex-col items-center justify-center rounded-2xl border transition-all duration-200',
                    selected
                      ? 'border-ink-900 bg-ink-900 text-paper shadow-soft'
                      : empty
                        ? 'border-transparent text-ink-300'
                        : 'border-ink-900/10 bg-card text-ink-900 hover:border-ink-900/40',
                  )}
                >
                  <span className={cn('text-[11px] font-medium uppercase tracking-wider', selected ? 'text-brass-200' : empty ? '' : 'text-ink-500')}>
                    {d.date === today ? 'Today' : weekdayShort(d.date)}
                  </span>
                  <span className={cn('display mt-0.5 text-[26px] leading-none', empty && 'line-through decoration-1')}>{dayOfMonth(d.date)}</span>
                </button>
              );
            })}
      </div>

      <div className="mt-4 min-h-40">
        <p className="mb-4 text-sm text-ink-500">
          {isoDayLong(date)}
          {slots.data && slots.data.slots.length > 0 && <span className="text-ink-400"> · {slots.data.slots.length} {slots.data.slots.length === 1 ? "time" : "times"} free</span>}
        </p>

        {slots.isLoading ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-11 !rounded-full" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-ink-900/15 px-6 py-10 text-center">
            <CalendarX2 className="mb-3 size-6 text-ink-400" />
            <p className="text-sm font-medium text-ink-800">Nothing free on this day</p>
            <p className="mt-1 text-sm text-ink-500">
              {firstFree ? (
                <>
                  The next opening is{' '}
                  <button type="button" className="font-medium text-brass-600 underline underline-offset-4" onClick={() => onDateChange(firstFree)}>
                    {isoDayLong(firstFree)}
                  </button>
                  .
                </>
              ) : (
                'This barber is fully booked for the next 30 days.'
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="eyebrow mb-2.5">{g.label}</p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {g.slots.map((s) => {
                    const selected = value?.startAt === s.startAt;
                    return (
                      <button
                        key={s.startAt}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onChange(selected ? null : s)}
                        className={cn(
                          'tnum h-11 rounded-full border text-sm font-medium transition-all duration-150',
                          selected
                            ? 'border-brass-400 bg-brass-400 text-ink-950 shadow-soft'
                            : 'border-ink-900/12 bg-card text-ink-900 hover:border-ink-900/45',
                        )}
                      >
                        {s.time}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
