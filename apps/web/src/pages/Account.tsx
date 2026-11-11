import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarClock, CalendarPlus, CreditCard, Package, Scissors, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { CancelBookingDialog, MoveDialog } from '../components/BookingDialogs';
import { PaymentDialog, PayTarget } from '../components/PaymentDialog';
import {
  Avatar,
  BookingBadge,
  Button,
  ButtonLink,
  Card,
  cn,
  ConfirmDialog,
  Empty,
  Input,
  Notice,
  OrderBadge,
  PaymentBadge,
  Skeleton,
  toast,
} from '../components/ui';
import { api, ApiError, Booking, errorMessage, Order, OrderStatus, Page, User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, dayOfMonth, fullName, isoDate, money, monthShort, time, weekdayShort } from '../lib/format';

export function AccountLayout() {
  const { user } = useAuth();
  if (!user) return null;
  const tabs = [
    ...(user.role === 'CLIENT' ? [{ to: '/account', label: 'Bookings', end: true }] : []),
    { to: '/account/orders', label: 'Orders', end: false },
    { to: '/account/profile', label: 'Profile', end: false },
  ];
  return (
    <div className="mx-auto max-w-5xl px-5 pt-12 sm:px-8 sm:pt-16">
      <p className="eyebrow mb-3">Your account</p>
      <h1 className="display text-6xl text-ink-950 sm:text-7xl">
        Hello, <span className="italic">{user.firstName}.</span>
      </h1>
      <nav className="mt-9 mb-10 flex gap-1 border-b hairline" aria-label="Account">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 px-4 pb-3.5 text-[15px] font-medium transition-colors',
                isActive ? 'border-ink-900 text-ink-950' : 'border-transparent text-ink-500 hover:text-ink-950',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

// ---- Bookings ---------------------------------------------------------------------------------

function DateBlock({ at, muted }: { at: string; muted?: boolean }) {
  const iso = isoDate(at);
  return (
    <div className={cn('flex w-[72px] shrink-0 flex-col items-center justify-center rounded-2xl py-3', muted ? 'bg-ink-900/5 text-ink-600' : 'bg-ink-900 text-paper')}>
      <span className={cn('text-[11px] font-medium uppercase tracking-wider', muted ? 'text-ink-500' : 'text-brass-300')}>{weekdayShort(iso)}</span>
      <span className="display mt-0.5 text-[32px] leading-none">{dayOfMonth(iso)}</span>
      <span className="mt-1 text-[11px] uppercase tracking-wider opacity-70">{monthShort(iso)}</span>
    </div>
  );
}

export function AccountBookings() {
  const [moving, setMoving] = useState<Booking | null>(null);
  const [canceling, setCanceling] = useState<Booking | null>(null);
  const [pay, setPay] = useState<PayTarget | null>(null);

  const bookings = useQuery({
    queryKey: ['bookings', 'mine'],
    queryFn: () => api<Page<Booking>>('/bookings', { query: { limit: 100, order: 'desc' } }),
  });
  const all = bookings.data?.items ?? [];
  const upcoming = all.filter((b) => b.status === 'BOOKED' || b.status === 'IN_PROGRESS').reverse();
  const past = all.filter((b) => b.status !== 'BOOKED' && b.status !== 'IN_PROGRESS');

  if (bookings.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 !rounded-3xl" />
        <Skeleton className="h-36 !rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-14">
      <section>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="display text-3xl text-ink-950">Coming up</h2>
          <ButtonLink to="/book" size="sm">
            <CalendarPlus className="size-4" /> New booking
          </ButtonLink>
        </div>
        {upcoming.length === 0 ? (
          <Card>
            <Empty icon={<Scissors />} title="No visits planned" action={<ButtonLink to="/book">Book a visit</ButtonLink>}>
              When you book, it shows up here — with options to move, cancel or pay online.
            </Empty>
          </Card>
        ) : (
          <ul className="space-y-4">
            {upcoming.map((b, i) => (
              <li key={b.id} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <Card className="p-5 sm:p-6">
                  <div className="flex gap-5">
                    <DateBlock at={b.startAt} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <h3 className="display text-[28px] text-ink-950">{b.service.name}</h3>
                          <p className="tnum mt-1 text-[15px] text-ink-600">
                            {time(b.startAt)} – {time(b.serviceEndAt)}
                          </p>
                        </div>
                        <p className="display tnum text-3xl text-ink-950">{money(b.priceSnapshot)}</p>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5">
                        <span className="flex items-center gap-2.5 text-sm text-ink-700">
                          <Avatar person={b.barber} src={b.barber.photoUrl} size={28} /> {fullName(b.barber)}
                        </span>
                        <BookingBadge status={b.status} />
                        <PaymentBadge status={b.paymentStatus} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-2 border-t hairline pt-4">
                    {b.actions.pay && (
                      <Button size="sm" onClick={() => setPay({ kind: 'bookings', id: b.id, label: `${b.service.name} with ${b.barber.firstName}`, amount: b.priceSnapshot })}>
                        <CreditCard className="size-4" /> Pay online
                      </Button>
                    )}
                    {b.actions.move && (
                      <Button size="sm" variant="outline" onClick={() => setMoving(b)}>
                        <CalendarClock className="size-4" /> Move
                      </Button>
                    )}
                    {b.actions.cancel && (
                      <Button size="sm" variant="ghost" onClick={() => setCanceling(b)}>
                        <X className="size-4" /> Cancel
                      </Button>
                    )}
                    {b.status === 'BOOKED' && !b.actions.move && (
                      <p className="text-[13px] text-ink-500">Less than 2 hours to go — to change this visit, please call the shop.</p>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="display mb-5 text-3xl text-ink-950">History</h2>
          <Card className="divide-y divide-ink-900/8 overflow-hidden">
            {past.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 sm:px-6">
                <p className="tnum w-36 text-sm text-ink-500">{dateTime(b.startAt)}</p>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink-950">{b.service.name}</p>
                  <p className="text-[13px] text-ink-500">with {fullName(b.barber)}</p>
                </div>
                <BookingBadge status={b.status} />
                {b.paymentStatus !== 'UNPAID' && b.paymentStatus !== 'PAID' && <PaymentBadge status={b.paymentStatus} />}
                <p className="tnum w-20 text-right text-[15px] text-ink-700">{money(b.priceSnapshot)}</p>
                {b.status === 'COMPLETED' && (
                  <ButtonLink to={`/book?service=${b.service.id}&barber=${b.barber.id}`} size="sm" variant="outline">
                    Book again
                  </ButtonLink>
                )}
              </div>
            ))}
          </Card>
        </section>
      )}

      <MoveDialog booking={moving} onClose={() => setMoving(null)} />
      <CancelBookingDialog booking={canceling} onClose={() => setCanceling(null)} />
      <PaymentDialog target={pay} onClose={() => setPay(null)} />
    </div>
  );
}

// ---- Orders -----------------------------------------------------------------------------------

const FLOW: OrderStatus[] = ['CREATED', 'IN_PROGRESS', 'READY', 'RECEIVED'];
const FLOW_LABEL = ['Placed', 'Preparing', 'Ready', 'Collected'];

export function OrderProgress({ status }: { status: OrderStatus }) {
  const at = FLOW.indexOf(status);
  if (at < 0) return null;
  return (
    <ol className="flex items-center" aria-label={`Order progress: ${FLOW_LABEL[at]}`}>
      {FLOW.map((s, i) => (
        <li key={s} className={cn('flex items-center', i < FLOW.length - 1 && 'flex-1')}>
          <span className="flex flex-col items-center gap-1.5">
            <span className={cn('size-2.5 rounded-full transition-colors', i <= at ? 'bg-brass-400 ring-4 ring-brass-100' : 'bg-ink-200')} />
            <span className={cn('text-[11px] font-medium', i <= at ? 'text-ink-900' : 'text-ink-400')}>{FLOW_LABEL[i]}</span>
          </span>
          {i < FLOW.length - 1 && <span className={cn('mx-2 mb-5 h-0.5 flex-1 rounded-full', i < at ? 'bg-brass-400' : 'bg-ink-200')} />}
        </li>
      ))}
    </ol>
  );
}

const ORDER_REFUND = {
  none: 'Order canceled.',
  manual: 'Order canceled. It was paid in cash — collect your refund at the shop.',
  refunding: 'Order canceled. The refund is on its way to your card.',
  refunded: 'Order canceled and refunded.',
  failed: 'Order canceled. The refund could not be started automatically — the shop will sort it out.',
};

export function AccountOrders() {
  const queryClient = useQueryClient();
  const [pay, setPay] = useState<PayTarget | null>(null);
  const [canceling, setCanceling] = useState<Order | null>(null);
  const orders = useQuery({ queryKey: ['orders', 'mine'], queryFn: () => api<Page<Order>>('/orders', { query: { limit: 50 } }) });

  const cancel = useMutation({
    mutationFn: (id: string) => api<Order>(`/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: (o) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(ORDER_REFUND[o.refund ?? 'none']);
      setCanceling(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (orders.isLoading) return <Skeleton className="h-48 !rounded-3xl" />;
  const list = orders.data?.items ?? [];
  if (list.length === 0) {
    return (
      <Card>
        <Empty icon={<Package />} title="No orders yet" action={<ButtonLink to="/shop">Visit the shop</ButtonLink>}>
          Products you order are collected at the shop. We will let you know when they are ready.
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <ul className="space-y-5">
        {list.map((o, i) => (
          <li key={o.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}>
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
                <div>
                  <p className="eyebrow">Pickup code</p>
                  <p className="display tnum mt-1 text-4xl tracking-[0.12em] text-ink-950">{o.pickupCode}</p>
                  <p className="mt-1.5 text-[13px] text-ink-500">Placed {date(o.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className="display tnum text-3xl text-ink-950">{money(o.totalPrice)}</p>
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <OrderBadge status={o.status} />
                    <PaymentBadge status={o.paymentStatus} />
                  </div>
                </div>
              </div>
              {o.status !== 'CANCELED' && (
                <div className="px-5 pb-5 sm:px-6">
                  <OrderProgress status={o.status} />
                </div>
              )}
              <ul className="divide-y divide-ink-900/8 border-t hairline bg-white/60">
                {o.items.map((item) => (
                  <li key={item.productId} className="flex items-center gap-4 px-5 py-3 sm:px-6">
                    <div className="size-12 shrink-0 overflow-hidden rounded-xl bg-ink-100">{item.photoUrl && <img src={item.photoUrl} alt="" className="size-full object-cover" />}</div>
                    <p className="min-w-0 flex-1 truncate text-sm text-ink-900">{item.name}</p>
                    <p className="tnum text-sm text-ink-500">× {item.quantity}</p>
                    <p className="tnum w-20 text-right text-sm text-ink-900">{money(item.lineTotal)}</p>
                  </li>
                ))}
              </ul>
              {(o.actions.pay || o.actions.cancel) && (
                <div className="flex flex-wrap gap-2 border-t hairline px-5 py-4 sm:px-6">
                  {o.actions.pay && (
                    <Button size="sm" onClick={() => setPay({ kind: 'orders', id: o.id, label: `Order ${o.pickupCode}`, amount: o.totalPrice })}>
                      <CreditCard className="size-4" /> Pay online
                    </Button>
                  )}
                  {o.actions.cancel && (
                    <Button size="sm" variant="ghost" onClick={() => setCanceling(o)}>
                      <X className="size-4" /> Cancel order
                    </Button>
                  )}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!canceling}
        onClose={() => setCanceling(null)}
        onConfirm={() => canceling && cancel.mutate(canceling.id)}
        title="Cancel this order?"
        confirmLabel="Cancel order"
        danger
        loading={cancel.isPending}
      >
        Order {canceling?.pickupCode} will be canceled and the items go back on the shelf.
        {canceling?.paymentStatus === 'PAID' && ' Your payment will be refunded.'}
      </ConfirmDialog>
      <PaymentDialog target={pay} onClose={() => setPay(null)} />
    </>
  );
}

// ---- Profile ----------------------------------------------------------------------------------

const fieldErrors = (e: unknown): Record<string, string> =>
  e instanceof ApiError && Array.isArray(e.details)
    ? Object.fromEntries((e.details as { field: string; errors: string[] }[]).map((d) => [d.field, d.errors[0]]))
    : {};

export function AccountProfile() {
  const { user, setUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ firstName: user!.firstName, lastName: user!.lastName ?? '', phoneNumber: user!.phoneNumber, email: user!.email ?? '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', password: '' });
  const [closing, setClosing] = useState(false);

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ id: string; type: string; body: string; createdAt: string }[]>('/users/me/notifications'),
  });

  const save = useMutation({
    mutationFn: () => api<User>('/users/me', { method: 'PATCH', body: { ...form, email: form.email.trim() || null } }),
    onSuccess: (u) => {
      setUser(u);
      toast.success('Profile saved.');
    },
  });
  const changePassword = useMutation({
    mutationFn: () => api<User>('/users/me', { method: 'PATCH', body: passwords }),
    onSuccess: () => {
      setPasswords({ currentPassword: '', password: '' });
      toast.success('Password changed.');
    },
  });
  const deactivate = useMutation({
    mutationFn: () => api<{ canceledBookings: number; canceledOrders: number }>('/users/me/deactivate', { method: 'POST' }),
    onSuccess: async () => {
      await signOut();
      toast.info('Your account is closed. Thank you for visiting us.');
      navigate('/');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const errors = fieldErrors(save.error);
  const passwordErrors = fieldErrors(changePassword.error);
  const submit = (fn: () => void) => (e: FormEvent) => {
    e.preventDefault();
    fn();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-6">
        <Card className="p-6 sm:p-8">
          <h2 className="display text-3xl text-ink-950">Your details</h2>
          <form onSubmit={submit(() => save.mutate())} className="mt-6 space-y-4" noValidate>
            {save.error && !Object.keys(errors).length && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} error={errors.firstName} />
              <Input label="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} error={errors.lastName} />
            </div>
            <Input label="Phone number" type="tel" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} error={errors.phoneNumber} hint="This is also what you sign in with." />
            <Input label="E-mail (optional)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
            <Button type="submit" loading={save.isPending}>
              Save changes
            </Button>
          </form>
        </Card>

        <Card className="p-6 sm:p-8">
          <h2 className="display text-3xl text-ink-950">Password</h2>
          <form onSubmit={submit(() => changePassword.mutate())} className="mt-6 space-y-4" noValidate>
            {changePassword.error && !Object.keys(passwordErrors).length && <Notice tone="bad">{errorMessage(changePassword.error)}</Notice>}
            <Input label="Current password" type="password" autoComplete="current-password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} error={passwordErrors.currentPassword} />
            <Input label="New password" type="password" autoComplete="new-password" value={passwords.password} onChange={(e) => setPasswords({ ...passwords, password: e.target.value })} error={passwordErrors.password} hint="At least 8 characters." />
            <Button type="submit" variant="outline" loading={changePassword.isPending} disabled={!passwords.currentPassword || passwords.password.length < 8}>
              Change password
            </Button>
          </form>
        </Card>

        {user!.role === 'CLIENT' && (
          <Card className="p-6 sm:p-8">
            <h2 className="display text-3xl text-ink-950">Close your account</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              Your upcoming bookings and open orders are canceled (paid ones are refunded when due) and you are signed out
              everywhere. Past visits stay in the shop's records.
            </p>
            <Button variant="outline" className="mt-5 !border-bad-600/30 !text-bad-600 hover:!bg-bad-50" onClick={() => setClosing(true)}>
              Close my account
            </Button>
          </Card>
        )}
      </div>

      <Card className="self-start p-6 sm:p-8">
        <h2 className="display flex items-center gap-3 text-3xl text-ink-950">
          <Bell className="size-5 text-brass-500" /> Messages
        </h2>
        <p className="mt-1.5 text-sm text-ink-500">What we have sent to your phone.</p>
        <ul className="mt-5 space-y-4">
          {notifications.isLoading && <Skeleton className="h-16" />}
          {notifications.data?.length === 0 && <li className="text-sm text-ink-500">Nothing yet. Confirmations and reminders will appear here.</li>}
          {notifications.data?.map((n) => (
            <li key={n.id} className="border-l-2 border-brass-300 pl-4">
              <p className="text-sm leading-relaxed text-ink-800">{n.body}</p>
              <p className="tnum mt-1 text-[12px] text-ink-400">{dateTime(n.createdAt)}</p>
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog open={closing} onClose={() => setClosing(false)} onConfirm={() => deactivate.mutate()} title="Close your account?" confirmLabel="Close account" danger loading={deactivate.isPending}>
        This cancels everything you have coming up and signs you out. To come back later you will need to contact the shop.
      </ConfirmDialog>
    </div>
  );
}
