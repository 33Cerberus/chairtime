import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, Copy, KeyRound, Search, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ClientPicker, NewBookingDialog } from '../../components/StaffDialogs';
import { Avatar, Badge, Button, Card, cn, ConfirmDialog, Dialog, Empty, IconButton, Input, Notice, PageHeader, Segmented, Select, Skeleton, toast } from '../../components/ui';
import { api, ApiError, errorMessage, Page, PasswordLink, Role, User } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, fullName, phone } from '../../lib/format';

const LIMIT = 20;
const ROLE_LABEL: Record<Role, string> = { CLIENT: 'Client', BARBER: 'Barber', ADMIN: 'Administrator', OWNER: 'Owner' };
type Filter = 'CLIENT' | 'STAFF' | 'ALL';

export function PasswordLinkNotice({ link, name }: { link: PasswordLink; name: string }) {
  return (
    <Notice tone="ok">
      <p className="font-medium text-ink-950">Single-use link for {name}</p>
      <p className="mt-1">Send it to them privately. They open it and choose their own password. Valid until {date(link.expiresAt)}.</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 text-[12px] text-ink-800">{link.url}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(link.url).then(() => toast.success('Link copied.'), () => toast.error('Could not copy — select the link and copy it by hand.'))}
        >
          <Copy className="size-3.5" /> Copy
        </Button>
      </div>
    </Notice>
  );
}

function UserSheet({ userId, onClose, onBook }: { userId: string | null; onClose: () => void; onBook: (u: User) => void }) {
  const { user: me, isOwner } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ firstName: '', lastName: '', phoneNumber: '', email: '' });
  const [link, setLink] = useState<PasswordLink | null>(null);
  const [confirm, setConfirm] = useState(false);

  const query = useQuery({ queryKey: ['users', userId], queryFn: () => api<User>(`/users/${userId}`), enabled: !!userId });
  const u = query.data;
  useEffect(() => {
    if (u) setForm({ firstName: u.firstName, lastName: u.lastName ?? '', phoneNumber: u.phoneNumber, email: u.email ?? '' });
    setLink(null);
  }, [u?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const fail = (e: unknown) => toast.error(errorMessage(e));

  const save = useMutation({
    mutationFn: () => api<User>(`/users/${userId}`, { method: 'PATCH', body: { ...form, email: form.email.trim() || null } }),
    onSuccess: () => {
      refresh();
      toast.success('Saved.');
    },
    onError: fail,
  });
  const issueLink = useMutation({ mutationFn: () => api<PasswordLink>(`/users/${userId}/password-link`, { method: 'POST' }), onSuccess: setLink, onError: fail });
  const setRole = useMutation({
    mutationFn: (role: Role) => api<User>(`/users/${userId}/role`, { method: 'PATCH', body: { role } }),
    onSuccess: (updated) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['barbers'] });
      toast.success(`${updated.firstName} is now ${ROLE_LABEL[updated.role].toLowerCase()}.`);
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: () => api<{ canceledBookings?: number; canceledOrders?: number }>(`/users/${userId}/${u?.isActive ? 'deactivate' : 'activate'}`, { method: 'POST' }),
    onSuccess: (r) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['barbers'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setConfirm(false);
      const extra = r.canceledBookings || r.canceledOrders ? ` ${r.canceledBookings ?? 0} booking(s) and ${r.canceledOrders ?? 0} order(s) were canceled.` : '';
      toast.success(u?.isActive ? `Account deactivated.${extra}` : 'Account reactivated.');
    },
    onError: (e) => {
      setConfirm(false);
      fail(e);
    },
  });

  // Administrators are managed by the owner only; the owner's account by the owner alone.
  const locked = !!u && u.id !== me?.id && (u.role === 'OWNER' || (u.role === 'ADMIN' && !isOwner));

  return (
    <>
      <Dialog open={!!userId} onClose={onClose} variant="sheet" title={u ? fullName(u) : 'Account'} description={u && `${ROLE_LABEL[u.role]} · joined ${date(u.createdAt)}`}>
        {!u ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Badge tone={u.isActive ? 'ok' : 'neutral'} dot>
                {u.isActive ? 'Active' : 'Deactivated'}
              </Badge>
              {!u.hasPassword && <Badge tone="brass">No password yet</Badge>}
            </div>
            {locked && <Notice tone="info">Only the owner can change this account.</Notice>}

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <Input label="First name" value={form.firstName} disabled={locked} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                <Input label="Last name" value={form.lastName} disabled={locked} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </div>
              <Input label="Phone number" type="tel" value={form.phoneNumber} disabled={locked} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
              <Input label="E-mail" type="email" value={form.email} disabled={locked} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              {!locked && (
                <Button type="submit" loading={save.isPending}>
                  Save changes
                </Button>
              )}
            </form>

            {isOwner && u.role !== 'OWNER' && (
              <Select label="Role" value={u.role} disabled={setRole.isPending} onChange={(e) => setRole.mutate(e.target.value as Role)} hint="Changing the role signs the person out. A barber must have no upcoming bookings.">
                <option value="CLIENT">Client</option>
                <option value="BARBER">Barber</option>
                <option value="ADMIN">Administrator</option>
              </Select>
            )}

            {!locked && u.role !== 'OWNER' && (
              <div className="space-y-2.5 border-t hairline pt-6">
                {u.isActive && (
                  <Button className="w-full" variant="outline" onClick={() => onBook(u)}>
                    <CalendarPlus className="size-4" /> Book a visit for {u.firstName}
                  </Button>
                )}
                {u.isActive && (
                  <Button className="w-full" variant="outline" loading={issueLink.isPending} onClick={() => issueLink.mutate()}>
                    <KeyRound className="size-4" /> {u.hasPassword ? 'Create a password reset link' : 'Create a link to set a password'}
                  </Button>
                )}
                {link && <PasswordLinkNotice link={link} name={u.firstName} />}
                {u.id !== me?.id && (
                  <Button className={cn('w-full', u.isActive && '!text-bad-600 hover:!bg-bad-50')} variant="ghost" onClick={() => (u.isActive ? setConfirm(true) : toggle.mutate())} loading={!u.isActive && toggle.isPending}>
                    {u.isActive ? 'Deactivate account' : 'Reactivate account'}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => toggle.mutate()} title={`Deactivate ${u?.firstName}?`} confirmLabel="Deactivate" danger loading={toggle.isPending}>
        They are signed out and can no longer sign in. Their upcoming bookings and open orders as a customer are canceled.
        {u?.role === 'BARBER' && ' A barber with upcoming bookings cannot be deactivated until those are moved or canceled.'} Nothing is deleted — you can reactivate the account later.
      </ConfirmDialog>
    </>
  );
}

export default function StaffClients() {
  const [filter, setFilter] = useState<Filter>('CLIENT');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<User | null>(null);
  const [booking, setBooking] = useState<User | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(input.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [input]);

  // "Staff" is three roles and the API filters by one, so that view is narrowed on the client.
  const users = useQuery({
    queryKey: ['users', 'list', filter, search, page],
    queryFn: () => api<Page<User>>('/users', { query: { role: filter === 'CLIENT' ? 'CLIENT' : undefined, search, page: filter === 'STAFF' ? 1 : page, limit: filter === 'STAFF' ? 100 : LIMIT } }),
    placeholderData: keepPreviousData,
  });
  const items = (users.data?.items ?? []).filter((u) => filter !== 'STAFF' || u.role !== 'CLIENT');
  const total = filter === 'STAFF' ? items.length : (users.data?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <>
      <PageHeader
        eyebrow="Front desk"
        title="Clients"
        action={
          <Button onClick={() => { setCreated(null); setCreating(true); }}>
            <UserPlus className="size-4" /> New client
          </Button>
        }
      >
        Everyone with an account, plus records created at the desk for people who booked by phone.
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          value={filter}
          onChange={(v) => { setFilter(v); setPage(1); }}
          options={[
            { value: 'CLIENT', label: 'Clients' },
            { value: 'STAFF', label: 'Staff' },
            { value: 'ALL', label: 'Everyone' },
          ]}
        />
        <label className="relative ml-auto block w-full sm:w-72">
          <span className="sr-only">Search people</span>
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-400" />
          <input type="search" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Name or phone" className="h-10 w-full rounded-full border border-ink-900/12 bg-card pr-4 pl-10 text-sm placeholder:text-ink-400 focus:border-brass-500 focus:ring-4 focus:ring-brass-400/20 focus:outline-none" />
        </label>
      </div>

      <Card className="overflow-hidden">
        {users.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty icon={<Users />} title="No one found">
            {search ? `Nothing matches “${search}”.` : 'No accounts in this group yet.'}
          </Empty>
        ) : (
          <ul className={cn('divide-y divide-ink-900/6 transition-opacity', users.isPlaceholderData && 'opacity-60')}>
            {items.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => setSelected(u.id)} className={cn('flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-ink-900/[0.03]', !u.isActive && 'opacity-55')}>
                  <Avatar person={u} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink-950">{fullName(u)}</span>
                    <span className="tnum block text-[13px] text-ink-500">{phone(u.phoneNumber)}</span>
                  </span>
                  <span className="hidden flex-wrap justify-end gap-2 sm:flex">
                    {!u.hasPassword && <Badge tone="brass">Phone record</Badge>}
                    {u.role !== 'CLIENT' && <Badge tone={u.role === 'OWNER' ? 'dark' : 'info'}>{ROLE_LABEL[u.role]}</Badge>}
                    {!u.isActive && <Badge>Deactivated</Badge>}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-300" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {filter !== 'STAFF' && total > LIMIT && (
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

      <UserSheet userId={selected} onClose={() => setSelected(null)} onBook={(u) => { setSelected(null); setBooking(u); }} />
      <NewBookingDialog open={!!booking} onClose={() => setBooking(null)} initial={{ client: booking }} />
      <Dialog open={creating} onClose={() => setCreating(false)} title="New client" description="Search first — the person may already have a record." size="sm">
        <ClientPicker value={created} onChange={setCreated} />
        {created && (
          <div className="mt-5 flex gap-2">
            <Button onClick={() => { setCreating(false); setBooking(created); }}>
              <CalendarPlus className="size-4" /> Book a visit
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Done
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}

export { ApiError };
