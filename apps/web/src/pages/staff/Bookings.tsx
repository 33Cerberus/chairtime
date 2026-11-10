import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ClipboardList, Plus } from 'lucide-react';
import { useState } from 'react';
import { BookingSheet } from '../../components/BookingDialogs';
import { NewBookingDialog } from '../../components/StaffDialogs';
import { Avatar, BookingBadge, Button, Card, cn, Empty, IconButton, PageHeader, PaymentBadge, Segmented, Select, Skeleton } from '../../components/ui';
import { api, Barber, Booking, BookingStatus, Page } from '../../lib/api';
import { addDays, dateTime, fullName, isoDate, money, phone, zonedTime } from '../../lib/format';

type Scope = 'upcoming' | 'today' | 'past' | 'all';
const LIMIT = 20;

export default function StaffBookings() {
  const [scope, setScope] = useState<Scope>('upcoming');
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [barberId, setBarberId] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const barbers = useQuery({ queryKey: ['barbers'], queryFn: () => api<Barber[]>('/barbers') });
  const today = isoDate();
  const range: Record<Scope, { from?: string; to?: string; order: 'asc' | 'desc' }> = {
    upcoming: { from: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(), order: 'asc' },
    today: { from: zonedTime(today).toISOString(), to: zonedTime(addDays(today, 1)).toISOString(), order: 'asc' },
    past: { to: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(), order: 'desc' },
    all: { order: 'desc' },
  };

  const bookings = useQuery({
    queryKey: ['bookings', 'list', scope, status, barberId, page],
    queryFn: () => api<Page<Booking>>('/bookings', { query: { ...range[scope], status, barberId, page, limit: LIMIT } }),
    placeholderData: keepPreviousData,
  });
  const total = bookings.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        eyebrow="Front desk"
        title="Bookings"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New booking
          </Button>
        }
      >
        Every visit, past and planned. Open one to start it, take payment, move or cancel it.
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          value={scope}
          onChange={reset(setScope)}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'today', label: 'Today' },
            { value: 'past', label: 'Past' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="ml-auto flex flex-wrap gap-3">
          <Select aria-label="Status" value={status} onChange={(e) => reset(setStatus)(e.target.value as BookingStatus | '')} className="!h-10 min-w-40 !rounded-full text-sm">
            <option value="">Any status</option>
            <option value="BOOKED">Booked</option>
            <option value="IN_PROGRESS">In the chair</option>
            <option value="COMPLETED">Completed</option>
            <option value="NO_SHOW">No-show</option>
            <option value="CANCELED">Canceled</option>
          </Select>
          <Select aria-label="Barber" value={barberId} onChange={(e) => reset(setBarberId)(e.target.value)} className="!h-10 min-w-40 !rounded-full text-sm">
            <option value="">Every barber</option>
            {barbers.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {fullName(b)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        {bookings.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : total === 0 ? (
          <Empty icon={<ClipboardList />} title="No bookings here">
            Nothing matches these filters.
          </Empty>
        ) : (
          <div className={cn('overflow-x-auto transition-opacity', bookings.isPlaceholderData && 'opacity-60')}>
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b hairline text-[12px] text-ink-500">
                  {['When', 'Client', 'Service', 'Barber', 'Status', 'Payment', 'Price'].map((h, i) => (
                    <th key={h} scope="col" className={cn('px-5 py-3.5 font-medium', i === 6 && 'text-right')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-900/6">
                {bookings.data?.items.map((b) => (
                  <tr key={b.id} tabIndex={0} onClick={() => setSelected(b.id)} onKeyDown={(e) => e.key === 'Enter' && setSelected(b.id)} className="cursor-pointer transition-colors hover:bg-ink-900/[0.03] focus-visible:bg-ink-900/[0.04]">
                    <td className="tnum px-5 py-3.5 whitespace-nowrap text-ink-950">{dateTime(b.startAt)}</td>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-ink-950">{fullName(b.client)}</p>
                      <p className="tnum text-[12px] text-ink-500">{phone(b.client.phoneNumber)}</p>
                    </td>
                    <td className="px-5 py-3.5 text-ink-800">{b.service.name}</td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-2.5 text-ink-800">
                        <Avatar person={b.barber} src={b.barber.photoUrl} size={26} /> {b.barber.firstName}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <BookingBadge status={b.status} />
                    </td>
                    <td className="px-5 py-3.5">
                      <PaymentBadge status={b.paymentStatus} />
                    </td>
                    <td className="tnum px-5 py-3.5 text-right font-medium text-ink-950">{money(b.priceSnapshot)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > LIMIT && (
          <div className="flex items-center justify-between border-t hairline px-5 py-3">
            <p className="tnum text-[13px] text-ink-500">
              {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <span className="tnum px-2 text-[13px] text-ink-600">
                {page} / {pages}
              </span>
              <IconButton label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
          </div>
        )}
      </Card>

      <BookingSheet bookingId={selected} onClose={() => setSelected(null)} />
      <NewBookingDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
