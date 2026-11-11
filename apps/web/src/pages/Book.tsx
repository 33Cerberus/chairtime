import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CalendarPlus, Check, Clock, CreditCard, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { PaymentDialog, PayTarget } from '../components/PaymentDialog';
import { SlotPicker } from '../components/SlotPicker';
import { Avatar, Button, ButtonLink, cn, Notice, PageLoader, Textarea, toast } from '../components/ui';
import { api, ApiError, Barber, Booking, errorMessage, PaymentConfig, Service, Slot } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dayLong, duration, fullName, isoDate, money, time } from '../lib/format';
import { useBarbers, useServices } from './Home';

type Step = 'service' | 'barber' | 'time' | 'confirm';
const STEPS: { id: Step; label: string }[] = [
  { id: 'service', label: 'Service' },
  { id: 'barber', label: 'Barber' },
  { id: 'time', label: 'Time' },
  { id: 'confirm', label: 'Confirm' },
];

/** A calendar file, so the visit lands in the client's own calendar. */
function downloadIcs(b: Booking) {
  const stamp = (v: string) => new Date(v).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chairtime//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${b.id}@chairtime`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(b.startAt)}`,
    `DTEND:${stamp(b.serviceEndAt)}`,
    `SUMMARY:${b.service.name} with ${b.barber.firstName} — Chairtime`,
    'LOCATION:ul. Mokotowska 41\\, 00-551 Warszawa',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'chairtime-booking.ics' });
  a.click();
  URL.revokeObjectURL(url);
}

export default function Book() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { user, ready } = useAuth();
  const queryClient = useQueryClient();
  const services = useServices();
  const barbers = useBarbers();

  const serviceId = params.get('service');
  const barberId = params.get('barber');
  const start = params.get('start');
  const date = params.get('date') ?? isoDate();

  // Online payment is offered only when the server can actually take one.
  const payments = useQuery({ queryKey: ['payments-config'], queryFn: () => api<PaymentConfig>('/payments/config'), staleTime: 5 * 60_000 });
  const canPayOnline = !!payments.data && payments.data.provider !== 'none';

  const [note, setNote] = useState('');
  const [payOnline, setPayOnline] = useState(false);
  const [done, setDone] = useState<Booking | null>(null);
  const [pay, setPay] = useState<PayTarget | null>(null);

  const barber = barbers.data?.find((b) => b.id === barberId) ?? null;
  const service = services.data?.find((s) => s.id === serviceId) ?? null;
  const offer = barber?.services.find((s) => s.serviceId === serviceId) ?? null;
  // A barber and a service that do not go together cannot both stay selected.
  const pairOk = !barber || !service || !!offer;

  const reached: Step = !service ? 'service' : !barber || !pairOk ? 'barber' : !start ? 'time' : 'confirm';
  const wanted = params.get('step') as Step | null;
  const order = STEPS.map((s) => s.id);
  const step: Step = wanted && order.indexOf(wanted) <= order.indexOf(reached) ? wanted : reached;

  const patch = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v === null ? next.delete(k) : next.set(k, v);
    setParams(next, { replace: false });
  };

  // Each step starts at the top of the page, not wherever the last one was scrolled to.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const slot: Slot | null = start && service ? { startAt: start, endAt: new Date(new Date(start).getTime() + service.duration * 60_000).toISOString(), time: time(start) } : null;

  const create = useMutation({
    mutationFn: () =>
      api<Booking>('/bookings', {
        method: 'POST',
        body: { barberId, serviceId, startAt: start, ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
      queryClient.invalidateQueries({ queryKey: ['slot-calendar'] });
      setDone(booking);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (payOnline && canPayOnline) setPay({ kind: 'bookings', id: booking.id, label: `${booking.service.name} with ${booking.barber.firstName}`, amount: booking.priceSnapshot });
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      // The slot went to someone else, or a rule changed: send them back to pick again.
      if (e instanceof ApiError && e.status === 409) {
        queryClient.invalidateQueries({ queryKey: ['slots'] });
        queryClient.invalidateQueries({ queryKey: ['slot-calendar'] });
        patch({ start: null, step: 'time' });
      }
    },
  });

  if (services.isLoading || barbers.isLoading || !ready) return <PageLoader />;

  // ---- Confirmation screen --------------------------------------------------------------------
  if (done) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center sm:py-24">
        <div className="mx-auto flex size-16 animate-rise items-center justify-center rounded-full bg-ok-600 text-white shadow-soft">
          <Check className="size-7" strokeWidth={2.5} />
        </div>
        <h1 className="display mt-8 animate-rise text-6xl text-ink-950 [animation-delay:80ms] sm:text-7xl">
          You are <span className="italic">booked.</span>
        </h1>
        <p className="mt-4 animate-rise text-ink-500 [animation-delay:140ms]">We will send a reminder the day before.</p>

        <div className="mt-10 animate-rise overflow-hidden rounded-[28px] border hairline bg-card text-left shadow-soft [animation-delay:200ms]">
          <div className="flex items-center gap-4 bg-ink-900 px-6 py-5 text-paper">
            <Avatar person={done.barber} src={done.barber.photoUrl} size={52} />
            <div>
              <p className="display text-2xl">{done.service.name}</p>
              <p className="text-sm text-ink-300">with {fullName(done.barber)}</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-px bg-ink-900/8 sm:grid-cols-3">
            {[
              ['When', dayLong(done.startAt)],
              ['Time', `${time(done.startAt)} – ${time(done.serviceEndAt)}`],
              ['Price', money(done.priceSnapshot)],
            ].map(([k, v]) => (
              <div key={k} className="bg-card px-6 py-4 last:col-span-2 sm:last:col-span-1">
                <dt className="eyebrow">{k}</dt>
                <dd className="tnum mt-1.5 text-[15px] font-medium text-ink-950">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-8 flex animate-rise flex-wrap justify-center gap-3 [animation-delay:260ms]">
          <ButtonLink to="/account">View my bookings</ButtonLink>
          <Button variant="outline" onClick={() => downloadIcs(done)}>
            <CalendarPlus className="size-4" /> Add to calendar
          </Button>
        </div>
        <p className="mt-6 text-[13px] text-ink-400">Plans change? Move or cancel free of charge up to 2 hours before.</p>
        <PaymentDialog target={pay} onClose={() => setPay(null)} />
      </div>
    );
  }

  const serviceList: (Service & { exact?: number })[] = (services.data ?? [])
    .filter((s) => s.priceFrom !== null)
    .filter((s) => !barber || barber.services.some((o) => o.serviceId === s.id))
    .map((s) => ({ ...s, exact: barber?.services.find((o) => o.serviceId === s.id)?.price }));
  const barberList: Barber[] = (barbers.data ?? []).filter((b) => !service || b.services.some((o) => o.serviceId === service.id));

  return (
    <div className="mx-auto max-w-7xl px-5 pt-10 pb-32 sm:px-8 sm:pt-14 lg:pb-10">
      {/* Progress */}
      <ol className="mb-10 flex items-center gap-2 sm:gap-3" aria-label="Booking steps">
        {STEPS.map((s, i) => {
          const current = s.id === step;
          const available = order.indexOf(s.id) <= order.indexOf(reached);
          const complete = order.indexOf(s.id) < order.indexOf(step);
          return (
            <li key={s.id} className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                disabled={!available}
                aria-current={current ? 'step' : undefined}
                onClick={() => patch({ step: s.id })}
                className={cn(
                  'flex items-center gap-2.5 rounded-full py-1.5 pr-4 pl-1.5 text-sm font-medium transition-colors',
                  current ? 'bg-ink-900 text-paper' : available ? 'text-ink-700 hover:bg-ink-900/6' : 'text-ink-300',
                )}
              >
                <span
                  className={cn(
                    'tnum flex size-7 items-center justify-center rounded-full text-[12px]',
                    current ? 'bg-brass-400 text-ink-950' : complete ? 'bg-ink-900 text-paper' : 'bg-ink-900/8',
                  )}
                >
                  {complete ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn(!current && 'hidden sm:inline')}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <span className="h-px w-4 bg-ink-900/15 sm:w-8" />}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-10 lg:grid-cols-[1fr_380px] lg:gap-16">
        <div key={step} className="min-w-0 animate-rise">
          {step === 'service' && (
            <>
              <h1 className="display text-5xl text-ink-950 sm:text-6xl">
                What are we <span className="italic">doing today?</span>
              </h1>
              {barber && (
                <p className="mt-4 text-ink-500">
                  Showing what {barber.firstName} offers.{' '}
                  <button type="button" className="font-medium text-brass-600 underline underline-offset-4" onClick={() => patch({ barber: null })}>
                    See every service
                  </button>
                </p>
              )}
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {serviceList.map((s) => {
                  const selected = s.id === serviceId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => patch({ service: s.id, start: null, step: barber ? 'time' : 'barber' })}
                      className={cn(
                        'group flex flex-col rounded-3xl border p-6 text-left transition-all duration-200',
                        selected ? 'border-ink-900 bg-ink-900 text-paper shadow-soft' : 'border-ink-900/10 bg-card hover:border-ink-900/40 hover:shadow-soft',
                      )}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <h3 className="display text-[28px]">{s.name}</h3>
                        <span className={cn('tnum mt-1.5 flex shrink-0 items-center gap-1.5 text-[13px]', selected ? 'text-ink-300' : 'text-ink-500')}>
                          <Clock className="size-3.5" /> {duration(s.duration)}
                        </span>
                      </div>
                      {s.description && <p className={cn('mt-2 text-sm leading-relaxed', selected ? 'text-ink-300' : 'text-ink-500')}>{s.description}</p>}
                      <p className="tnum mt-5 text-[15px] font-medium">
                        {s.exact !== undefined ? money(s.exact) : `${s.priceFrom !== s.priceTo ? 'from ' : ''}${money(s.priceFrom!)}`}
                      </p>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 'barber' && service && (
            <>
              <h1 className="display text-5xl text-ink-950 sm:text-6xl">
                Who is <span className="italic">cutting?</span>
              </h1>
              <p className="mt-4 text-ink-500">
                {barberList.length} {barberList.length === 1 ? 'barber offers' : 'barbers offer'} {service.name}. Each sets their own price.
              </p>
              {!pairOk && barber && (
                <Notice tone="warn" className="mt-6">
                  {barber.firstName} does not offer {service.name}. Pick one of the barbers below.
                </Notice>
              )}
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {barberList.map((b) => {
                  const price = b.services.find((o) => o.serviceId === service.id)!.price;
                  const selected = b.id === barberId;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => patch({ barber: b.id, start: null, step: 'time' })}
                      className={cn(
                        'flex items-center gap-5 rounded-3xl border p-4 text-left transition-all duration-200',
                        selected ? 'border-ink-900 bg-ink-900 text-paper shadow-soft' : 'border-ink-900/10 bg-card hover:border-ink-900/40 hover:shadow-soft',
                      )}
                    >
                      <div className="size-24 shrink-0 overflow-hidden rounded-2xl bg-ink-100">
                        {b.photoUrl && <img src={b.photoUrl} alt="" className="size-full object-cover object-top" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="display text-[28px]">{fullName(b)}</h3>
                        {b.title && <p className={cn('mt-0.5 truncate text-[13px]', selected ? 'text-ink-300' : 'text-ink-500')}>{b.title}</p>}
                        <p className="tnum mt-3 text-[15px] font-medium">{money(price)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 'time' && service && barber && (
            <>
              <h1 className="display text-5xl text-ink-950 sm:text-6xl">
                Pick <span className="italic">a time.</span>
              </h1>
              <p className="mt-4 mb-8 text-ink-500">
                {barber.firstName}'s live availability for the next 30 days. Times are Warsaw time.
              </p>
              <SlotPicker
                barberId={barber.id}
                serviceId={service.id}
                date={date}
                onDateChange={(d) => patch({ date: d, start: null })}
                value={slot}
                onChange={(s) => patch({ start: s?.startAt ?? null, ...(s ? { step: 'confirm' } : {}) })}
              />
            </>
          )}

          {step === 'confirm' && service && barber && slot && offer && (
            <>
              <h1 className="display text-5xl text-ink-950 sm:text-6xl">
                Looks <span className="italic">right?</span>
              </h1>
              <p className="mt-4 text-ink-500">Check the details, then confirm. You can move or cancel up to 2 hours before.</p>

              {!user ? (
                <div className="mt-8 rounded-3xl border hairline bg-card p-7 shadow-soft">
                  <h2 className="display text-3xl text-ink-950">One last step</h2>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-500">
                    Bookings belong to an account, so you can move or cancel them later. Your selection is kept while you sign in.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <ButtonLink to="/register" state={{ from: location.pathname + location.search }}>
                      Create an account
                    </ButtonLink>
                    <ButtonLink to="/login" variant="outline" state={{ from: location.pathname + location.search }}>
                      I already have one
                    </ButtonLink>
                  </div>
                </div>
              ) : user.role !== 'CLIENT' ? (
                <Notice tone="info" className="mt-8">
                  {user.role === 'BARBER'
                    ? 'Barber accounts cannot make bookings. Ask the front desk, or use a personal client account.'
                    : 'Staff book on behalf of clients from the dashboard, where you can pick or create the client.'}{' '}
                  {user.role !== 'BARBER' && (
                    <Link to="/staff/bookings" className="font-medium underline underline-offset-4">
                      Open bookings
                    </Link>
                  )}
                </Notice>
              ) : (
                <div className="mt-8 space-y-7">
                  {!canPayOnline && (
                    <Notice tone="info">You pay at the shop after your visit — card or cash.</Notice>
                  )}
                  <fieldset hidden={!canPayOnline}>
                    <legend className="eyebrow mb-3">Payment</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        { online: false, icon: <Store />, title: 'Pay at the shop', body: 'Card or cash after your visit.' },
                        { online: true, icon: <CreditCard />, title: 'Pay online now', body: 'Refunded in full if you cancel in time.' },
                      ].map((o) => (
                        <label
                          key={String(o.online)}
                          className={cn(
                            'flex cursor-pointer gap-4 rounded-3xl border p-5 transition-all duration-200',
                            payOnline === o.online ? 'border-ink-900 bg-card shadow-soft ring-1 ring-ink-900' : 'border-ink-900/10 bg-card hover:border-ink-900/40',
                          )}
                        >
                          <input type="radio" name="payment" className="sr-only" checked={payOnline === o.online} onChange={() => setPayOnline(o.online)} />
                          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full [&>svg]:size-[18px]', payOnline === o.online ? 'bg-ink-900 text-brass-300' : 'bg-ink-900/6 text-ink-600')}>
                            {o.icon}
                          </span>
                          <span>
                            <span className="block text-[15px] font-medium text-ink-950">{o.title}</span>
                            <span className="mt-0.5 block text-[13px] text-ink-500">{o.body}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <Textarea
                    label="Anything your barber should know? (optional)"
                    placeholder="e.g. growing it out, sensitive skin, running five minutes late…"
                    maxLength={300}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button size="lg" className="w-full sm:w-auto" loading={create.isPending} onClick={() => create.mutate()}>
                    Confirm booking <ArrowRight className="size-4" />
                  </Button>
                </div>
              )}
            </>
          )}

          {step !== 'service' && (
            <button
              type="button"
              onClick={() => patch({ step: order[order.indexOf(step) - 1] })}
              className="mt-10 inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-950"
            >
              <ArrowLeft className="size-4" /> Back
            </button>
          )}
        </div>

        {/* Summary */}
        <aside className="hidden lg:block">
          <div className="grain sticky top-28 isolate overflow-hidden rounded-[28px] bg-ink-900 p-7 text-paper shadow-lift">
            <p className="eyebrow text-brass-300">Your visit</p>
            <dl className="mt-6 space-y-5">
              <SummaryRow label="Service" value={service?.name} sub={service ? duration(service.duration) : undefined} />
              <SummaryRow label="Barber" value={barber && pairOk ? fullName(barber) : undefined} sub={barber && pairOk ? barber.title?.split('·')[0] : undefined} />
              <SummaryRow label="When" value={slot ? dayLong(slot.startAt) : undefined} sub={slot ? `${slot.time} – ${time(slot.endAt)}` : undefined} />
            </dl>
            <div className="mt-7 flex items-baseline justify-between border-t border-white/10 pt-6">
              <span className="text-sm text-ink-300">{offer ? 'Total' : 'Starting at'}</span>
              <span className="display tnum text-4xl">
                {offer ? money(offer.price) : service?.priceFrom != null ? money(service.priceFrom) : '—'}
              </span>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile summary bar */}
      {service && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t hairline bg-paper/95 px-5 py-3.5 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-950">
                {service.name}
                {barber && pairOk ? ` · ${barber.firstName}` : ''}
              </p>
              <p className="truncate text-[13px] text-ink-500">{slot ? `${dayLong(slot.startAt)}, ${slot.time}` : duration(service.duration)}</p>
            </div>
            <p className="display tnum shrink-0 text-3xl text-ink-950">{offer ? money(offer.price) : service.priceFrom != null ? money(service.priceFrom) : ''}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, sub }: { label: string; value?: string | null; sub?: string | null }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-400">{label}</dt>
      <dd className={cn('display mt-1 text-2xl', !value && 'text-ink-600')}>{value ?? 'Not chosen yet'}</dd>
      {sub && <dd className="tnum mt-0.5 text-[13px] text-ink-300">{sub}</dd>}
    </div>
  );
}
