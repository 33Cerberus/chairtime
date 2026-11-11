import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CalendarClock, Check, Phone, Play, RotateCcw, UserX, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, Booking, BookingStatus, errorMessage, PaymentStatus, Slot } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dayLong, duration, fullName, isoDate, money, phone, time } from '../lib/format';
import { SlotPicker } from './SlotPicker';
import { Avatar, BookingBadge, Button, Dialog, Notice, PaymentBadge, Pole, Textarea, toast } from './ui';

export function useInvalidateBookings() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
    queryClient.invalidateQueries({ queryKey: ['booking'] });
    queryClient.invalidateQueries({ queryKey: ['slots'] });
    queryClient.invalidateQueries({ queryKey: ['slot-calendar'] });
  };
}

/** Moving changes the time only; barber and service stay as booked. */
export function MoveDialog({ booking, onClose }: { booking: Booking | null; onClose: () => void }) {
  const invalidate = useInvalidateBookings();
  const [date, setDate] = useState(isoDate());
  const [slot, setSlot] = useState<Slot | null>(null);

  useEffect(() => {
    if (booking) {
      setDate(isoDate(booking.startAt) < isoDate() ? isoDate() : isoDate(booking.startAt));
      setSlot(null);
    }
  }, [booking]);

  const move = useMutation({
    mutationFn: () => api<Booking>(`/bookings/${booking!.id}`, { method: 'PATCH', body: { startAt: slot!.startAt } }),
    onSuccess: (b) => {
      invalidate();
      toast.success(`Moved to ${dayLong(b.startAt)} at ${time(b.startAt)}.`);
      onClose();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      invalidate();
      setSlot(null);
    },
  });

  return (
    <Dialog
      open={!!booking}
      onClose={onClose}
      size="lg"
      title="Move this booking"
      description={booking && `${booking.service.name} with ${booking.barber.firstName} — currently ${dayLong(booking.startAt)} at ${time(booking.startAt)}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep the current time
          </Button>
          <Button disabled={!slot} loading={move.isPending} onClick={() => move.mutate()}>
            {slot ? `Move to ${slot.time}` : 'Pick a new time'}
          </Button>
        </>
      }
    >
      {booking && (
        <SlotPicker
          barberId={booking.barber.id}
          serviceId={booking.service.id}
          date={date}
          onDateChange={setDate}
          value={slot}
          onChange={setSlot}
          excludeBookingId={booking.id}
        />
      )}
    </Dialog>
  );
}

const REFUND_MESSAGE = {
  none: 'Booking canceled.',
  manual: 'Canceled. It was paid in cash — hand the money back and mark it refunded.',
  refunding: 'Canceled. The refund is on its way to the card.',
  refunded: 'Canceled. The payment has been refunded.',
  failed: 'Canceled, but the refund could not be started. Open the booking and refund it again.',
};

export function CancelBookingDialog({ booking, onClose }: { booking: Booking | null; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const invalidate = useInvalidateBookings();
  const [reason, setReason] = useState('');
  const paid = booking?.paymentStatus === 'PAID';
  const inWindow = booking ? new Date(booking.startAt).getTime() - Date.now() >= 2 * 3_600_000 : true;
  const [refund, setRefund] = useState(true);

  useEffect(() => {
    setReason('');
    setRefund(inWindow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id]);

  const cancel = useMutation({
    mutationFn: () =>
      api<Booking>(`/bookings/${booking!.id}/cancel`, {
        method: 'POST',
        body: { ...(reason.trim() ? { reason: reason.trim() } : {}), ...(isAdmin && paid ? { refund } : {}) },
      }),
    onSuccess: (b) => {
      invalidate();
      toast.success(REFUND_MESSAGE[b.refund ?? 'none']);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog
      open={!!booking}
      onClose={onClose}
      size="sm"
      title="Cancel this booking?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel booking
          </Button>
        </>
      }
    >
      {booking && (
        <div className="space-y-5">
          <p className="text-[15px] leading-relaxed text-ink-600">
            {booking.service.name} with {booking.barber.firstName} on{' '}
            <strong className="font-medium text-ink-950">
              {dayLong(booking.startAt)} at {time(booking.startAt)}
            </strong>
            . The time goes back on sale straight away.
          </p>
          {paid && !isAdmin && <Notice tone="ok">You paid {money(booking.priceSnapshot)} online. It will be refunded in full.</Notice>}
          {paid && isAdmin && (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border hairline bg-card p-4">
              <input type="checkbox" className="mt-1 size-4 accent-ink-900" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
              <span className="text-sm leading-relaxed text-ink-700">
                <span className="font-medium text-ink-950">Refund {money(booking.priceSnapshot)}</span>
                <br />
                {inWindow ? 'More than 2 hours before the visit: a refund is due.' : 'Less than 2 hours before the visit: by policy no refund is due, but you can still give one.'}
              </span>
            </label>
          )}
          <Textarea label="Reason (optional)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={isAdmin ? 'e.g. client called, barber is ill' : 'Helps us plan better'} />
        </div>
      )}
    </Dialog>
  );
}

/** Staff view of one booking: who, what, when, and every action this person may take right now. */
export function BookingSheet({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) {
  const invalidate = useInvalidateBookings();
  const [moving, setMoving] = useState<Booking | null>(null);
  const [canceling, setCanceling] = useState<Booking | null>(null);

  const query = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => api<Booking>(`/bookings/${bookingId}`),
    enabled: !!bookingId,
    // `actions` depend on the clock (e.g. no-show unlocks 15 minutes after the start).
    refetchInterval: 30_000,
  });
  const b = query.data;

  const setStatus = useMutation({
    mutationFn: (status: BookingStatus) => api<Booking>(`/bookings/${bookingId}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: (updated) => {
      invalidate();
      toast.success({ IN_PROGRESS: 'Visit started.', COMPLETED: 'Visit completed.', NO_SHOW: 'Marked as a no-show.' }[updated.status as string] ?? 'Updated.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setPayment = useMutation({
    mutationFn: (paymentStatus: PaymentStatus) =>
      api<Booking>(`/bookings/${bookingId}/payment-status`, { method: 'PATCH', body: { paymentStatus } }),
    onSuccess: (updated) => {
      invalidate();
      toast.success(updated.paymentStatus === 'PAID' ? 'Marked as paid.' : updated.paymentStatus === 'REFUNDING' ? 'Refund started.' : 'Marked as refunded.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const busy = setStatus.isPending || setPayment.isPending;

  return (
    <>
      <Dialog open={!!bookingId && !moving && !canceling} onClose={onClose} variant="sheet" title={b?.service.name ?? 'Booking'} description={b && `${dayLong(b.startAt)} · ${time(b.startAt)} – ${time(b.serviceEndAt)}`}>
        {!b ? (
          <div className="flex justify-center py-16">
            <Pole />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <BookingBadge status={b.status} />
              <PaymentBadge status={b.paymentStatus} />
            </div>

            <div className="rounded-2xl border hairline bg-white p-5">
              <p className="eyebrow mb-3">Client</p>
              <div className="flex items-center gap-3.5">
                <Avatar person={b.client} size={44} />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-ink-950">{fullName(b.client)}</p>
                  <a href={`tel:${b.client.phoneNumber}`} className="tnum mt-0.5 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-brass-600">
                    <Phone className="size-3.5" /> {phone(b.client.phoneNumber)}
                  </a>
                </div>
              </div>
              {b.note && <p className="mt-4 rounded-xl bg-brass-50 px-3.5 py-2.5 text-sm leading-relaxed text-ink-700">“{b.note}”</p>}
            </div>

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border hairline bg-ink-900/8">
              {[
                ['Barber', fullName(b.barber)],
                ['Length', duration(b.durationSnapshot)],
                ['Price', money(b.priceSnapshot)],
                ['Booked on', dayLong(b.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="bg-white px-5 py-3.5">
                  <dt className="text-[12px] text-ink-500">{k}</dt>
                  <dd className="tnum mt-0.5 text-sm font-medium text-ink-950">{v}</dd>
                </div>
              ))}
            </dl>

            {b.status === 'CANCELED' && (
              <Notice tone="warn">
                Canceled{b.canceledAt ? ` on ${dayLong(b.canceledAt)}` : ''}
                {b.cancelReason ? ` — “${b.cancelReason}”` : '.'}
              </Notice>
            )}

            <div className="space-y-2.5">
              <p className="eyebrow">Actions</p>
              {b.actions.start && (
                <Button className="w-full" size="lg" variant="brass" loading={busy} onClick={() => setStatus.mutate('IN_PROGRESS')}>
                  <Play className="size-4" /> Client is here — start the visit
                </Button>
              )}
              {b.actions.complete && (
                <Button className="w-full" size="lg" loading={busy} onClick={() => setStatus.mutate('COMPLETED')}>
                  <Check className="size-4" /> Complete the visit
                </Button>
              )}
              {b.actions.markPaid && (
                <Button className="w-full" variant="outline" loading={busy} onClick={() => setPayment.mutate('PAID')}>
                  <Banknote className="size-4" /> Paid at the desk — mark as paid
                </Button>
              )}
              {b.actions.noShow && (
                <Button className="w-full" variant="outline" loading={busy} onClick={() => setStatus.mutate('NO_SHOW')}>
                  <UserX className="size-4" /> Client did not show up
                </Button>
              )}
              {b.actions.move && (
                <Button className="w-full" variant="outline" onClick={() => setMoving(b)}>
                  <CalendarClock className="size-4" /> Move to another time
                </Button>
              )}
              {b.actions.refund && b.status !== 'BOOKED' && (
                <Button className="w-full" variant="outline" loading={busy} onClick={() => setPayment.mutate('REFUNDED')}>
                  <RotateCcw className="size-4" /> Refund {money(b.priceSnapshot)}
                </Button>
              )}
              {b.actions.cancel && (
                <Button className="w-full" variant="ghost" onClick={() => setCanceling(b)}>
                  <X className="size-4" /> Cancel the booking
                </Button>
              )}
              {!Object.values(b.actions).some(Boolean) && (
                <p className="text-sm text-ink-500">
                  {b.status === 'BOOKED' ? 'The visit can be started from 30 minutes before its time.' : 'This booking is closed. Nothing more to do.'}
                </p>
              )}
              {b.status === 'BOOKED' && !b.actions.start && Object.values(b.actions).some(Boolean) && (
                <p className="pt-1 text-[13px] text-ink-500">Starting the visit unlocks 30 minutes before its time; a no-show, 15 minutes after.</p>
              )}
            </div>
          </div>
        )}
      </Dialog>
      <MoveDialog booking={moving} onClose={() => setMoving(null)} />
      <CancelBookingDialog booking={canceling} onClose={() => setCanceling(null)} />
    </>
  );
}
