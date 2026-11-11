import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Badge, Card, cn, Empty, IconButton, PageHeader, Select, Skeleton } from '../../components/ui';
import { api, Page, Role, User } from '../../lib/api';
import { dateTime, fullName } from '../../lib/format';

interface AuditEntry {
  id: string;
  createdAt: string;
  actor: { id: string; firstName: string; lastName: string | null } | null;
  actorRole: Role | null;
  method: string;
  route: string;
  targetId: string | null;
  statusCode: number;
}

const LIMIT = 30;
const ROLE: Record<Role, string> = { CLIENT: 'Client', BARBER: 'Barber', ADMIN: 'Administrator', OWNER: 'Owner' };

/**
 * Plain-language names for what each API action does, as infinitives: "cancel a booking".
 * Anything unlisted falls back to the raw route.
 */
const ACTIONS: Record<string, string> = {
  'POST /bookings': 'create a booking',
  'PATCH /bookings/:id': 'move a booking',
  'POST /bookings/:id/cancel': 'cancel a booking',
  'PATCH /bookings/:id/status': 'change a visit status',
  'PATCH /bookings/:id/payment-status': 'change a booking payment',
  'POST /orders': 'create an order',
  'POST /orders/:id/cancel': 'cancel an order',
  'PATCH /orders/:id/status': 'advance an order',
  'PATCH /orders/:id/payment-status': 'change an order payment',
  'POST /users/clients': 'create a client record',
  'POST /users/staff': 'create a staff account',
  'PATCH /users/:id': 'edit an account',
  'PATCH /users/:id/role': 'change a role',
  'POST /users/:id/password-link': 'issue a password link',
  'POST /users/:id/deactivate': 'deactivate an account',
  'POST /users/:id/activate': 'reactivate an account',
  'POST /services': 'create a service',
  'PATCH /services/:id': 'edit a service',
  'PATCH /barbers/:id': 'edit a barber profile',
  'POST /barbers/:id/photo': 'upload a barber photo',
  'POST /barbers/:id/services': 'add a service to a barber',
  'PATCH /barbers/:id/services/:serviceId': 'change a price',
  'DELETE /barbers/:id/services/:serviceId': 'remove a service from a barber',
  'PUT /barbers/:id/working-hours': 'change working hours',
  'PUT /barbers/:id/working-hours/:dayOfWeek': 'change working hours',
  'POST /barbers/:id/exceptions': 'add time off or extra hours',
  'DELETE /barbers/:id/exceptions/:exceptionId': 'remove time off or extra hours',
  'POST /products': 'create a product',
  'PATCH /products/:id': 'edit a product or its stock',
  'POST /products/:id/photos': 'upload a product photo',
  'POST /orders/:id/payments': 'start an online payment',
  'POST /payments/:id/mock-confirm': 'settle a test payment',
};

/** "cancel a booking" -> "canceled a booking". Every verb used above is regular. */
const past = (phrase: string) => phrase.replace(/^\w+/, (verb) => (verb.endsWith('e') ? `${verb}d` : `${verb}ed`));

/** What happened, or — for an attempt that was refused — what was tried. */
function describe(e: AuditEntry) {
  const action = ACTIONS[`${e.method} ${e.route.replace(/^\/api\/v\d+/, '')}`];
  if (!action) return `${e.statusCode < 400 ? 'called' : 'tried to call'} ${e.method} ${e.route}`;
  return e.statusCode < 400 ? past(action) : `tried to ${action}`;
}

/** Why an attempt did not go through, in words. */
const outcome = (status: number) =>
  status < 400 ? null : status === 403 ? 'Not allowed' : status === 404 ? 'Not found' : status === 409 ? 'Refused by a rule' : status === 400 ? 'Invalid input' : 'Failed';

export default function Activity() {
  const [actorId, setActorId] = useState('');
  const [page, setPage] = useState(1);

  const staff = useQuery({
    queryKey: ['users', 'staff-for-activity'],
    queryFn: () => api<Page<User>>('/users', { query: { limit: 100 } }),
    select: (d) => d.items.filter((u) => u.role !== 'CLIENT'),
  });
  const log = useQuery({
    queryKey: ['audit-log', actorId, page],
    queryFn: () => api<Page<AuditEntry>>('/audit-log', { query: { actorId, page, limit: LIMIT } }),
    placeholderData: keepPreviousData,
  });
  const total = log.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <>
      <PageHeader
        eyebrow="Owner"
        title="Activity"
        action={
          <Select
            aria-label="Staff member"
            value={actorId}
            onChange={(e) => {
              setActorId(e.target.value);
              setPage(1);
            }}
            className="!h-10 min-w-52 !rounded-full text-sm"
          >
            <option value="">Everyone on staff</option>
            {staff.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {fullName(u)}
              </option>
            ))}
          </Select>
        }
      >
        Every change made by a member of staff: who did what, and when. Entries are kept for 400 days.
      </PageHeader>

      <Card className="overflow-hidden">
        {log.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : total === 0 ? (
          <Empty icon={<History />} title="Nothing recorded yet">
            Changes made from the staff area will appear here.
          </Empty>
        ) : (
          <ul className={cn('divide-y divide-ink-900/6 transition-opacity', log.isPlaceholderData && 'opacity-60')}>
            {log.data?.items.map((e) => {
              const problem = outcome(e.statusCode);
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3">
                  {e.actor ? <Avatar person={e.actor} size={32} /> : <span className="size-8 rounded-full bg-ink-900/8" />}
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm text-ink-950">
                      <span className="font-medium">{e.actor ? fullName(e.actor) : 'Unknown'}</span>
                      <span className="text-ink-500"> · {describe(e)}</span>
                    </p>
                    <p className="text-[12px] text-ink-400">{e.actorRole ? ROLE[e.actorRole] : ''}</p>
                  </div>
                  {problem && <Badge tone={e.statusCode >= 500 ? 'bad' : 'warn'}>{problem}</Badge>}
                  <p className="tnum w-36 text-right text-[13px] text-ink-500">{dateTime(e.createdAt)}</p>
                </li>
              );
            })}
          </ul>
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
    </>
  );
}
