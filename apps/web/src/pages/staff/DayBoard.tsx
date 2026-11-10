import { useQueries, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BookingSheet } from '../../components/BookingDialogs';
import { NewBookingDialog } from '../../components/StaffDialogs';
import { Avatar, Button, cn, IconButton, PageHeader, Pole } from '../../components/ui';
import { api, Barber, Booking, BookingStatus, Page, ResolvedSchedule } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDays, fullName, isoDate, isoDayLong, minutesOfDay, money, relativeDay, time, zonedTime } from '../../lib/format';

const PX_PER_MIN = 1.6;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

const BLOCK: Record<BookingStatus, string> = {
  BOOKED: 'bg-white border-ink-900/12 text-ink-950 hover:border-ink-900/40 border-l-[3px] border-l-info-600',
  IN_PROGRESS: 'bg-brass-200 border-brass-400 text-ink-950 border-l-[3px] border-l-brass-600 shadow-soft',
  COMPLETED: 'bg-ok-50 border-ok-600/20 text-ink-800 border-l-[3px] border-l-ok-600',
  NO_SHOW: 'bg-bad-50 border-bad-600/20 text-ink-800 border-l-[3px] border-l-bad-600',
  CANCELED: 'bg-ink-50 border-dashed border-ink-900/15 text-ink-400 line-through',
};

/**
 * The day as a timeline, one column per barber. Administrators see everyone and can add
 * bookings; a barber sees their own column. Hatched areas are outside working hours.
 */
export default function DayBoard() {
  const { user, isAdmin } = useAuth();
  const [date, setDate] = useState(isoDate());
  const [selected, setSelected] = useState<string | null>(null);
  const [showCanceled, setShowCanceled] = useState(false);
  const [creating, setCreating] = useState<{ barberId?: string } | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const barbersQuery = useQuery({ queryKey: ['barbers'], queryFn: () => api<Barber[]>('/barbers') });
  const barbers = useMemo(
    () => (barbersQuery.data ?? []).filter((b) => isAdmin || b.id === user?.barberId),
    [barbersQuery.data, isAdmin, user?.barberId],
  );

  const bookingsQuery = useQuery({
    queryKey: ['bookings', 'day', date],
    queryFn: () => api<Page<Booking>>('/bookings', { query: { from: zonedTime(date).toISOString(), to: zonedTime(addDays(date, 1)).toISOString(), limit: 100 } }),
    refetchInterval: 45_000,
  });
  const schedules = useQueries({
    queries: barbers.map((b) => ({
      queryKey: ['schedule', b.id, date],
      queryFn: () => api<ResolvedSchedule>(`/barbers/${b.id}/schedule`, { query: { from: date, to: date } }),
    })),
  });

  const all = bookingsQuery.data?.items ?? [];
  const visible = all.filter((b) => showCanceled || b.status !== 'CANCELED');
  const live = all.filter((b) => b.status !== 'CANCELED');

  // The visible window: the earliest opening to the latest closing, padded, never less than 9–18.
  const hours = schedules.flatMap((s) => s.data?.days[0]?.hours ?? []);
  const startMins = [9 * 60, ...hours.map((h) => toMin(h.startTime)), ...visible.map((b) => minutesOfDay(b.startAt))];
  const endMins = [18 * 60, ...hours.map((h) => toMin(h.endTime)), ...visible.map((b) => minutesOfDay(b.startAt) + b.durationSnapshot + 15)];
  const from = Math.floor(Math.min(...startMins) / 60) * 60;
  const to = Math.ceil(Math.max(...endMins) / 60) * 60;
  const height = (to - from) * PX_PER_MIN;
  const hourMarks = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);

  const isToday = date === isoDate();
  const nowMin = minutesOfDay(now);
  const stats = [
    ['Visits', live.length],
    ['In the chair', live.filter((b) => b.status === 'IN_PROGRESS').length],
    ['Done', live.filter((b) => b.status === 'COMPLETED').length],
    ...(isAdmin ? [['Day value', money(live.filter((b) => b.status !== 'NO_SHOW').reduce((n, b) => n + b.priceSnapshot, 0))]] : []),
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow={isAdmin ? 'Front desk' : `${user?.firstName}'s chair`}
        title={
          <>
            {relativeDay(date)}
            {relativeDay(date) !== isoDayLong(date) && <span className="ml-3 text-3xl text-ink-400 italic sm:text-4xl">{isoDayLong(date)}</span>}
          </>
        }
        action={
          <>
            <div className="flex items-center rounded-full border border-ink-900/12 bg-card p-0.5">
              <IconButton label="Previous day" onClick={() => setDate(addDays(date, -1))} className="size-9">
                <ChevronLeft className="size-4" />
              </IconButton>
              <button type="button" onClick={() => setDate(isoDate())} disabled={isToday} className="h-9 rounded-full px-3 text-[13px] font-medium text-ink-800 hover:bg-ink-900/6 disabled:text-ink-400">
                Today
              </button>
              <IconButton label="Next day" onClick={() => setDate(addDays(date, 1))} className="size-9">
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
            <input
              type="date"
              aria-label="Jump to date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-10 rounded-full border border-ink-900/12 bg-card px-4 text-[13px] font-medium text-ink-800 focus:border-brass-500 focus:outline-none"
            />
            {isAdmin && (
              <Button onClick={() => setCreating({})}>
                <Plus className="size-4" /> New booking
              </Button>
            )}
          </>
        }
      />

      <dl className="mb-6 flex flex-wrap gap-x-10 gap-y-3">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[12px] text-ink-500">{label}</dt>
            <dd className="display tnum text-3xl text-ink-950">{value}</dd>
          </div>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-2 self-end text-[13px] text-ink-600">
          <input type="checkbox" className="size-4 accent-ink-900" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} />
          Show canceled
        </label>
      </dl>

      {barbersQuery.isLoading || bookingsQuery.isLoading ? (
        <div className="flex justify-center py-24">
          <Pole />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border hairline bg-card shadow-soft">
          <div className="flex min-w-max">
            {/* Hour gutter */}
            <div className="sticky left-0 z-20 w-14 shrink-0 border-r hairline bg-card">
              <div className="h-[68px] border-b hairline" />
              <div className="relative" style={{ height }}>
                {hourMarks.slice(0, -1).map((m) => (
                  <span key={m} className="tnum absolute right-2.5 -translate-y-1/2 text-[11px] text-ink-400" style={{ top: (m - from) * PX_PER_MIN }}>
                    {m === from ? '' : `${String(m / 60).padStart(2, '0')}:00`}
                  </span>
                ))}
              </div>
            </div>

            {barbers.map((barber, i) => {
              const day = schedules[i]?.data?.days[0];
              const working = day?.hours ?? [];
              const mine = visible.filter((b) => b.barber.id === barber.id);
              // Everything outside working hours is hatched.
              const off: [number, number][] = [];
              let cursor = from;
              for (const h of working) {
                if (toMin(h.startTime) > cursor) off.push([cursor, toMin(h.startTime)]);
                cursor = Math.max(cursor, toMin(h.endTime));
              }
              if (cursor < to) off.push([cursor, to]);

              return (
                <div key={barber.id} className={cn('min-w-[230px] flex-1', i > 0 && 'border-l hairline')}>
                  <div className="sticky top-0 z-10 flex h-[68px] items-center gap-3 border-b hairline bg-card/95 px-4 backdrop-blur">
                    <Avatar person={barber} src={barber.photoUrl} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-ink-950">{isAdmin ? barber.firstName : fullName(barber)}</p>
                      <p className="tnum truncate text-[12px] text-ink-500">
                        {working.length ? working.map((h) => `${h.startTime}–${h.endTime}`).join(' · ') : 'Day off'}
                      </p>
                    </div>
                    {isAdmin && (
                      <IconButton label={`New booking with ${barber.firstName}`} onClick={() => setCreating({ barberId: barber.id })} className="size-8">
                        <Plus className="size-4" />
                      </IconButton>
                    )}
                  </div>

                  <div className="relative" style={{ height }}>
                    {hourMarks.map((m) => (
                      <div key={m} className="absolute inset-x-0 border-t border-ink-900/6" style={{ top: (m - from) * PX_PER_MIN }} />
                    ))}
                    {hourMarks.slice(0, -1).map((m) => (
                      <div key={`h${m}`} className="absolute inset-x-0 border-t border-dashed border-ink-900/4" style={{ top: (m + 30 - from) * PX_PER_MIN }} />
                    ))}
                    {off.map(([a, b]) => (
                      <div
                        key={a}
                        className="absolute inset-x-0"
                        style={{
                          top: (a - from) * PX_PER_MIN,
                          height: (b - a) * PX_PER_MIN,
                          background: 'repeating-linear-gradient(-45deg, rgb(23 20 17 / 0.045) 0 6px, transparent 6px 12px)',
                        }}
                      />
                    ))}
                    {day?.exceptions.map((e) => (
                      <span
                        key={e.id}
                        className={cn('absolute right-2 z-[1] rounded-full px-2 py-0.5 text-[11px] font-medium', e.type === 'BLOCKING' ? 'bg-ink-900/8 text-ink-600' : 'bg-brass-100 text-brass-700')}
                        style={{ top: ((e.startTime ? toMin(e.startTime) : from) - from) * PX_PER_MIN + 6 }}
                      >
                        {e.type === 'BLOCKING' ? 'Time off' : 'Extra hours'}
                        {e.reason ? ` · ${e.reason}` : ''}
                      </span>
                    ))}

                    {mine.map((b) => {
                      const top = (minutesOfDay(b.startAt) - from) * PX_PER_MIN;
                      const h = b.durationSnapshot * PX_PER_MIN;
                      const compact = b.durationSnapshot <= 30;
                      return (
                        <div key={b.id} className="absolute inset-x-1.5 z-[2]" style={{ top }}>
                          <button
                            type="button"
                            onClick={() => setSelected(b.id)}
                            aria-label={`${time(b.startAt)} ${fullName(b.client)}, ${b.service.name}, ${b.status.toLowerCase().replace('_', ' ')}`}
                            className={cn('block w-full overflow-hidden rounded-xl border px-2.5 text-left transition-all duration-150 hover:z-10 hover:shadow-soft', BLOCK[b.status], compact ? 'py-1' : 'py-2')}
                            style={{ height: h - 2 }}
                          >
                            <p className="flex items-center justify-between gap-2 text-[13px] leading-tight font-medium">
                              <span className="truncate">{fullName(b.client)}</span>
                              <span className="tnum shrink-0 text-[11px] font-normal opacity-70">{time(b.startAt)}</span>
                            </p>
                            <p className={cn('truncate text-[12px] leading-tight opacity-70', compact ? 'mt-0' : 'mt-0.5')}>
                              {b.service.name}
                              {b.paymentStatus === 'PAID' && ' · paid'}
                            </p>
                          </button>
                          {/* The 15-minute buffer after the service. */}
                          {b.status !== 'CANCELED' && (
                            <div className="mx-2 rounded-b-md border-x border-b border-dashed border-ink-900/12" style={{ height: 15 * PX_PER_MIN - 2 }} title="15-minute buffer" />
                          )}
                        </div>
                      );
                    })}

                    {isToday && nowMin >= from && nowMin <= to && (
                      <div className="pointer-events-none absolute inset-x-0 z-[3] flex items-center" style={{ top: (nowMin - from) * PX_PER_MIN }}>
                        {i === 0 && <span className="-ml-1 size-2 rounded-full bg-bad-600" />}
                        <span className="h-px flex-1 bg-bad-600/70" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {barbers.length === 0 && <p className="p-10 text-sm text-ink-500">No active barbers yet. Add one under Team.</p>}
          </div>
        </div>
      )}

      <BookingSheet bookingId={selected} onClose={() => setSelected(null)} />
      <NewBookingDialog open={!!creating} onClose={() => setCreating(null)} initial={{ barberId: creating?.barberId, date }} />
    </>
  );
}
