import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Minus, Plus, Search, UserPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, Barber, Booking, errorMessage, Order, Page, ProductPage, Service, Slot, User } from '../lib/api';
import { dayLong, duration, fullName, isoDate, money, phone, time } from '../lib/format';
import { useInvalidateBookings } from './BookingDialogs';
import { SlotPicker } from './SlotPicker';
import { Avatar, Badge, Button, cn, Dialog, Input, Notice, Select, Textarea, toast } from './ui';

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Find a client by name or phone, or create a record with just a name and a number. */
export function ClientPicker({ value, onChange }: { value: User | null; onChange: (u: User | null) => void }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', phoneNumber: '' });
  const search = useDebounced(input.trim());

  const results = useQuery({
    queryKey: ['users', 'picker', search],
    queryFn: () => api<Page<User>>('/users', { query: { search, isActive: true, limit: 6 } }),
    enabled: !value && search.length >= 2,
  });

  const create = useMutation({
    mutationFn: () =>
      api<User>('/users/clients', {
        method: 'POST',
        body: { firstName: form.firstName, phoneNumber: form.phoneNumber, ...(form.lastName.trim() ? { lastName: form.lastName } : {}) },
      }),
    onSuccess: (u) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onChange(u);
      setCreating(false);
      toast.success(`Client record created for ${fullName(u)}.`);
    },
  });

  if (value) {
    return (
      <div className="flex items-center gap-3.5 rounded-2xl border border-ink-900 bg-white p-3.5 ring-1 ring-ink-900">
        <Avatar person={value} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-ink-950">{fullName(value)}</p>
          <p className="tnum text-[13px] text-ink-500">{phone(value.phoneNumber)}</p>
        </div>
        {!value.hasPassword && <Badge tone="brass">Phone record</Badge>}
        <button type="button" aria-label="Choose a different client" onClick={() => onChange(null)} className="flex size-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-900/6 hover:text-ink-950">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  if (creating) {
    const taken = create.error instanceof ApiError && create.error.status === 409;
    return (
      <div className="space-y-3 rounded-2xl border hairline bg-white p-4">
        <p className="text-sm font-medium text-ink-950">New client record</p>
        {create.error && <Notice tone="bad">{taken ? 'This number already has a record — search for it instead.' : errorMessage(create.error)}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoFocus />
          <Input label="Last name (optional)" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </div>
        <Input label="Phone number" type="tel" inputMode="tel" placeholder="600 100 200" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} hint="If they register later with this number, the history links to their account." />
        <div className="flex gap-2">
          <Button size="sm" loading={create.isPending} disabled={!form.firstName.trim() || !form.phoneNumber.trim()} onClick={() => create.mutate()}>
            Create record
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
            Back to search
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-400" />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search by name or phone"
          aria-label="Search clients"
          className="h-11 w-full rounded-xl border border-ink-900/12 bg-white pr-4 pl-11 text-[15px] placeholder:text-ink-400 focus:border-brass-500 focus:ring-4 focus:ring-brass-400/20 focus:outline-none"
        />
      </div>
      {search.length >= 2 && (
        <ul className="mt-2 overflow-hidden rounded-2xl border hairline bg-white">
          {results.isLoading && <li className="px-4 py-3 text-sm text-ink-500">Searching…</li>}
          {results.data?.items.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => onChange(u)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-900/4">
                <Avatar person={u} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-950">{fullName(u)}</span>
                  <span className="tnum block text-[13px] text-ink-500">{phone(u.phoneNumber)}</span>
                </span>
                {u.role !== 'CLIENT' && <Badge>{u.role.toLowerCase()}</Badge>}
              </button>
            </li>
          ))}
          {results.data?.items.length === 0 && <li className="px-4 py-3 text-sm text-ink-500">No one found for “{search}”.</li>}
        </ul>
      )}
      <button
        type="button"
        onClick={() => {
          const digits = input.replace(/[^\d+]/g, '');
          setForm({ firstName: digits.length >= 6 ? '' : input.trim(), lastName: '', phoneNumber: digits.length >= 6 ? input.trim() : '' });
          create.reset();
          setCreating(true);
        }}
        className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brass-600 hover:text-brass-700"
      >
        <UserPlus className="size-4" /> New client — name and phone only
      </button>
    </div>
  );
}

function StepTitle({ n, children, done }: { n: number; children: React.ReactNode; done?: boolean }) {
  return (
    <h3 className="mb-3 flex items-center gap-3 text-[15px] font-medium text-ink-950">
      <span className={cn('tnum flex size-6 items-center justify-center rounded-full text-[12px]', done ? 'bg-ink-900 text-paper' : 'bg-ink-900/8 text-ink-700')}>
        {done ? <Check className="size-3" strokeWidth={3} /> : n}
      </span>
      {children}
    </h3>
  );
}

/** A booking taken by phone or at the desk. */
export function NewBookingDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: { client?: User | null; barberId?: string; date?: string };
}) {
  const invalidate = useInvalidateBookings();
  const [client, setClient] = useState<User | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [barberId, setBarberId] = useState('');
  const [date, setDate] = useState(isoDate());
  const [slot, setSlot] = useState<Slot | null>(null);
  const [note, setNote] = useState('');

  const services = useQuery({ queryKey: ['services'], queryFn: () => api<Service[]>('/services'), enabled: open });
  const barbers = useQuery({ queryKey: ['barbers'], queryFn: () => api<Barber[]>('/barbers'), enabled: open });

  useEffect(() => {
    if (!open) return;
    setClient(initial?.client ?? null);
    setBarberId(initial?.barberId ?? '');
    setServiceId('');
    setDate(initial?.date && initial.date >= isoDate() ? initial.date : isoDate());
    setSlot(null);
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const barber = barbers.data?.find((b) => b.id === barberId);
  const offers = barber?.services ?? [];
  const offer = offers.find((o) => o.serviceId === serviceId);
  const serviceOptions = (services.data ?? []).filter((s) => s.isActive && s.priceFrom !== null && (!barber || offers.some((o) => o.serviceId === s.id)));
  const barberOptions = (barbers.data ?? []).filter((b) => !serviceId || b.services.some((o) => o.serviceId === serviceId));

  const create = useMutation({
    mutationFn: () =>
      api<Booking>('/bookings', {
        method: 'POST',
        body: { clientId: client!.id, barberId, serviceId, startAt: slot!.startAt, ...(note.trim() ? { note: note.trim() } : {}) },
      }),
    onSuccess: (b) => {
      invalidate();
      toast.success(`Booked ${fullName(b.client)} for ${dayLong(b.startAt)} at ${time(b.startAt)}.`);
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
      open={open}
      onClose={onClose}
      size="lg"
      title="New booking"
      description="For a client on the phone or at the desk."
      footer={
        <>
          {offer && slot && (
            <p className="tnum mr-auto text-sm text-ink-600">
              {slot.time} · {duration(offer.duration)} · <strong className="font-medium text-ink-950">{money(offer.price)}</strong>
            </p>
          )}
          <Button variant="ghost" onClick={onClose}>
            Discard
          </Button>
          <Button disabled={!client || !slot} loading={create.isPending} onClick={() => create.mutate()}>
            Book it
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <section>
          <StepTitle n={1} done={!!client}>
            Who is it for?
          </StepTitle>
          <ClientPicker value={client} onChange={setClient} />
        </section>

        <section>
          <StepTitle n={2} done={!!offer}>
            Service and barber
          </StepTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Service"
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setSlot(null);
              }}
            >
              <option value="">Choose a service</option>
              {serviceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {duration(s.duration)}
                </option>
              ))}
            </Select>
            <Select
              label="Barber"
              value={barberId}
              onChange={(e) => {
                setBarberId(e.target.value);
                setSlot(null);
              }}
            >
              <option value="">Choose a barber</option>
              {barberOptions.map((b) => {
                const price = b.services.find((o) => o.serviceId === serviceId)?.price;
                return (
                  <option key={b.id} value={b.id}>
                    {fullName(b)}
                    {price !== undefined ? ` · ${money(price)}` : ''}
                  </option>
                );
              })}
            </Select>
          </div>
        </section>

        <section>
          <StepTitle n={3} done={!!slot}>
            Time
          </StepTitle>
          {offer ? (
            <SlotPicker barberId={barberId} serviceId={serviceId} date={date} onDateChange={setDate} value={slot} onChange={setSlot} />
          ) : (
            <p className="rounded-2xl border border-dashed border-ink-900/15 px-4 py-6 text-center text-sm text-ink-500">Choose a service and a barber to see free times.</p>
          )}
        </section>

        <Textarea label="Note for the barber (optional)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}

/** An order taken by phone or at the desk, with explicit items. */
export function NewOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [client, setClient] = useState<User | null>(null);
  const [lines, setLines] = useState<Record<string, number>>({});
  const products = useQuery({ queryKey: ['products', 'for-order'], queryFn: () => api<ProductPage>('/products', { query: { limit: 100, includeInactive: false } }), enabled: open });

  useEffect(() => {
    if (open) {
      setClient(null);
      setLines({});
    }
  }, [open]);

  const list = products.data?.items ?? [];
  const total = list.reduce((sum, p) => sum + (lines[p.id] ?? 0) * p.price, 0);
  const count = Object.values(lines).reduce((a, b) => a + b, 0);
  const bump = (id: string, by: number, max: number) =>
    setLines((l) => {
      const next = Math.max(0, Math.min(max, (l[id] ?? 0) + by));
      const { [id]: _removed, ...rest } = l;
      return next ? { ...rest, [id]: next } : rest;
    });

  const create = useMutation({
    mutationFn: () =>
      api<Order>('/orders', {
        method: 'POST',
        body: { clientId: client!.id, items: Object.entries(lines).map(([productId, quantity]) => ({ productId, quantity })) },
      }),
    onSuccess: (o) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`Order ${o.pickupCode} created for ${fullName(o.client)}.`);
      onClose();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="New order"
      description="For a client on the phone or at the desk."
      footer={
        <>
          <p className="tnum mr-auto text-sm text-ink-600">
            {count} item{count === 1 ? '' : 's'} · <strong className="font-medium text-ink-950">{money(total)}</strong>
          </p>
          <Button variant="ghost" onClick={onClose}>
            Discard
          </Button>
          <Button disabled={!client || count === 0} loading={create.isPending} onClick={() => create.mutate()}>
            Create order
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <section>
          <StepTitle n={1} done={!!client}>
            Who is it for?
          </StepTitle>
          <ClientPicker value={client} onChange={setClient} />
        </section>
        <section>
          <StepTitle n={2} done={count > 0}>
            Products
          </StepTitle>
          <ul className="divide-y divide-ink-900/8 overflow-hidden rounded-2xl border hairline bg-white">
            {list.map((p) => {
              const q = lines[p.id] ?? 0;
              return (
                <li key={p.id} className={cn('flex items-center gap-3.5 px-4 py-2.5', p.stock === 0 && 'opacity-50')}>
                  <div className="size-11 shrink-0 overflow-hidden rounded-xl bg-ink-100">{p.photoUrls[0] && <img src={p.photoUrls[0]} alt="" className="size-full object-cover" />}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-950">{p.name}</p>
                    <p className="tnum text-[13px] text-ink-500">
                      {money(p.price)} · {p.stock === 0 ? 'sold out' : `${p.stock} in stock`}
                    </p>
                  </div>
                  <div className="inline-flex items-center rounded-full border border-ink-900/12">
                    <button type="button" aria-label={`One less ${p.name}`} disabled={q === 0} onClick={() => bump(p.id, -1, p.stock)} className="flex size-8 items-center justify-center rounded-full text-ink-600 hover:text-ink-950 disabled:opacity-30">
                      <Minus className="size-3.5" />
                    </button>
                    <span className="tnum w-6 text-center text-sm font-medium">{q}</span>
                    <button type="button" aria-label={`One more ${p.name}`} disabled={q >= p.stock} onClick={() => bump(p.id, 1, p.stock)} className="flex size-8 items-center justify-center rounded-full text-ink-600 hover:text-ink-950 disabled:opacity-30">
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}
