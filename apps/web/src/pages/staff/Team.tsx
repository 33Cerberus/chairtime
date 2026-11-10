import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ExceptionsEditor, HoursEditor, OffersEditor, ProfileEditor } from '../../components/BarberEditors';
import { Avatar, Badge, Button, Card, cn, Dialog, Empty, Input, Notice, PageHeader, Segmented, Select, Skeleton } from '../../components/ui';
import { api, ApiError, Barber, errorMessage, Page, PasswordLink, Role, User } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fullName } from '../../lib/format';
import { PasswordLinkNotice } from './Clients';

type Tab = 'profile' | 'services' | 'hours' | 'exceptions';
const TABS: { value: Tab; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'services', label: 'Services & prices' },
  { value: 'hours', label: 'Working hours' },
  { value: 'exceptions', label: 'Time off' },
];

function AddStaffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ firstName: '', lastName: '', phoneNumber: '', email: '', role: 'BARBER' as Role });
  const [result, setResult] = useState<{ user: User; passwordLink: PasswordLink } | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ firstName: '', lastName: '', phoneNumber: '', email: '', role: 'BARBER' });
      setResult(null);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => api<{ user: User; passwordLink: PasswordLink }>('/users/staff', { method: 'POST', body: { ...form, email: form.email.trim() || undefined } }),
    onSuccess: (r) => {
      setResult(r);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['barbers'] });
    },
  });
  const errors: Record<string, string> =
    create.error instanceof ApiError && Array.isArray(create.error.details)
      ? Object.fromEntries((create.error.details as { field: string; errors: string[] }[]).map((d) => [d.field, d.errors[0]]))
      : {};

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={result ? `${result.user.firstName} is on the team` : 'Add a staff member'}
      description={result ? undefined : 'They get a single-use link and choose their own password — you never see it.'}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Discard
            </Button>
            <Button loading={create.isPending} disabled={!form.firstName.trim() || !form.lastName.trim() || !form.phoneNumber.trim()} onClick={() => create.mutate()}>
              Create account
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <PasswordLinkNotice link={result.passwordLink} name={result.user.firstName} />
          {result.user.role === 'BARBER' && <p className="text-sm leading-relaxed text-ink-500">Next: give them services, prices and working hours. Until then they are not bookable.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {create.error && !Object.keys(errors).length && <Notice tone="bad">{errorMessage(create.error)}</Notice>}
          <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="BARBER">Barber — own calendar, schedule and profile</option>
            <option value="ADMIN">Administrator — front desk and shop setup</option>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} error={errors.firstName} />
            <Input label="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} error={errors.lastName} />
          </div>
          <Input label="Phone number" type="tel" inputMode="tel" placeholder="600 100 200" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} error={errors.phoneNumber} hint="They sign in with it." />
          <Input label="E-mail (optional)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        </div>
      )}
    </Dialog>
  );
}

function Editors({ barberId, tab }: { barberId: string; tab: Tab }) {
  return (
    <div key={`${barberId}-${tab}`} className="animate-fade">
      {tab === 'profile' && <ProfileEditor barberId={barberId} />}
      {tab === 'services' && <OffersEditor barberId={barberId} />}
      {tab === 'hours' && <HoursEditor barberId={barberId} />}
      {tab === 'exceptions' && <ExceptionsEditor barberId={barberId} />}
    </div>
  );
}

export default function StaffTeam() {
  const { isOwner } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [adding, setAdding] = useState(false);

  // The user list includes deactivated barbers; the public list does not.
  const team = useQuery({ queryKey: ['users', 'barbers'], queryFn: () => api<Page<User>>('/users', { query: { role: 'BARBER', limit: 100 } }) });
  const profiles = useQuery({ queryKey: ['barbers'], queryFn: () => api<Barber[]>('/barbers') });
  const barbers = (team.data?.items ?? []).filter((u) => u.barberId);
  const current = barbers.find((b) => b.barberId === selected) ?? barbers[0];

  return (
    <>
      <PageHeader
        eyebrow="Shop setup"
        title="Team"
        action={
          isOwner && (
            <Button onClick={() => setAdding(true)}>
              <UserPlus className="size-4" /> Add staff
            </Button>
          )
        }
      >
        Each barber's public profile, the services they offer and at what price, and when they work.
      </PageHeader>

      {team.isLoading ? (
        <Skeleton className="h-96 !rounded-3xl" />
      ) : barbers.length === 0 ? (
        <Card>
          <Empty icon={<UsersRound />} title="No barbers yet">
            {isOwner ? 'Add the first barber to open the diary.' : 'The owner adds staff accounts.'}
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <Card className="self-start overflow-hidden p-2">
            <ul className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
              {barbers.map((b) => {
                const profile = profiles.data?.find((p) => p.id === b.barberId);
                const active = current?.id === b.id;
                return (
                  <li key={b.id} className="shrink-0">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelected(b.barberId)}
                      className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors', active ? 'bg-ink-900 text-paper' : 'hover:bg-ink-900/5', !b.isActive && 'opacity-55')}
                    >
                      <Avatar person={b} src={profile?.photoUrl} size={40} />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium">{fullName(b)}</span>
                        <span className={cn('block truncate text-[12px]', active ? 'text-ink-300' : 'text-ink-500')}>
                          {!b.isActive ? 'Deactivated' : !b.hasPassword ? 'Invited — no password yet' : `${profile?.services.length ?? 0} services`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {current?.barberId && (
            <Card className="min-w-0 p-5 sm:p-8">
              <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="display text-4xl text-ink-950">{fullName(current)}</h2>
                  {!current.isActive && <Badge>Deactivated</Badge>}
                </div>
                <div className="max-w-full overflow-x-auto">
                  <Segmented value={tab} onChange={setTab} options={TABS} />
                </div>
              </div>
              <Editors barberId={current.barberId} tab={tab} />
            </Card>
          )}
        </div>
      )}
      <AddStaffDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

/** A barber's own working hours and time off. */
export function MySchedule() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'hours' | 'exceptions'>('hours');
  if (!user?.barberId) return null;
  return (
    <>
      <PageHeader eyebrow="My work" title="Working hours">
        Your weekly hours and one-off changes. Clients can only book inside them.
      </PageHeader>
      <Segmented
        className="mb-6"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'hours', label: 'Every week' },
          { value: 'exceptions', label: 'Time off & extra hours' },
        ]}
      />
      <Card className="p-5 sm:p-8">
        <Editors barberId={user.barberId} tab={tab} />
      </Card>
    </>
  );
}

/** A barber's own public profile. Services and prices are shown but belong to the front desk. */
export function MyProfile() {
  const { user } = useAuth();
  if (!user?.barberId) return null;
  return (
    <>
      <PageHeader eyebrow="My work" title="Public profile">
        What clients see when they choose a barber.
      </PageHeader>
      <div className="space-y-6">
        <Card className="p-5 sm:p-8">
          <ProfileEditor barberId={user.barberId} />
        </Card>
        <Card className="p-5 sm:p-8">
          <h2 className="display mb-5 text-3xl text-ink-950">Your services</h2>
          <OffersEditor barberId={user.barberId} readOnly />
        </Card>
      </div>
    </>
  );
}
