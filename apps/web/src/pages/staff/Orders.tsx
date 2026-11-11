import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Banknote, Package, Phone, Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { NewOrderDialog } from '../../components/StaffDialogs';
import { Button, Card, ConfirmDialog, Empty, OrderBadge, PageHeader, PaymentBadge, Segmented, Skeleton, toast } from '../../components/ui';
import { api, errorMessage, Order, OrderStatus, Page, PaymentStatus } from '../../lib/api';
import { dateTime, fullName, money, phone } from '../../lib/format';

type Tab = 'open' | 'collected' | 'canceled';
const STATUSES: Record<Tab, string> = { open: 'CREATED,IN_PROGRESS,READY', collected: 'RECEIVED', canceled: 'CANCELED' };
const ADVANCE_LABEL: Partial<Record<OrderStatus, string>> = { IN_PROGRESS: 'Start preparing', READY: 'Mark as ready', RECEIVED: 'Hand over' };
const REFUND = {
  none: 'Order canceled. Stock restored.',
  manual: 'Order canceled. It was paid in cash — hand the money back and mark it refunded.',
  refunding: 'Order canceled. The card refund is on its way.',
  refunded: 'Order canceled and refunded.',
  failed: 'Order canceled, but the refund could not be started. Use Refund on the order to try again.',
};

export default function StaffOrders() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('open');
  const [creating, setCreating] = useState(false);
  const [canceling, setCanceling] = useState<Order | null>(null);

  const orders = useQuery({
    queryKey: ['orders', 'staff', tab],
    queryFn: () => api<Page<Order>>('/orders', { query: { status: STATUSES[tab], limit: 60 } }),
    refetchInterval: 45_000,
  });
  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    toast.success(message);
  };
  const fail = (e: unknown) => toast.error(errorMessage(e));

  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => api<Order>(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: (o) => done({ IN_PROGRESS: `Preparing ${o.pickupCode}.`, READY: `${o.pickupCode} is ready — the client has been notified.`, RECEIVED: `${o.pickupCode} handed over.` }[o.status as string] ?? 'Updated.'),
    onError: fail,
  });
  const payment = useMutation({
    mutationFn: ({ id, paymentStatus }: { id: string; paymentStatus: PaymentStatus }) =>
      api<Order>(`/orders/${id}/payment-status`, { method: 'PATCH', body: { paymentStatus } }),
    onSuccess: (o) => done(o.paymentStatus === 'PAID' ? 'Marked as paid.' : o.paymentStatus === 'REFUNDING' ? 'Refund started.' : 'Marked as refunded.'),
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api<Order>(`/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: (o) => {
      done(REFUND[o.refund ?? 'none']);
      setCanceling(null);
    },
    onError: fail,
  });
  const busy = advance.isPending || payment.isPending;
  const list = orders.data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Front desk"
        title="Orders"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New order
          </Button>
        }
      >
        Product orders are collected at the shop. Prepare them, mark them ready, and hand them over against the pickup code.
      </PageHeader>

      <Segmented
        className="mb-6"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'collected', label: 'Collected' },
          { value: 'canceled', label: 'Canceled' },
        ]}
      />

      {orders.isLoading ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-64 !rounded-3xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <Empty icon={<Package />} title={tab === 'open' ? 'All caught up' : 'Nothing here'}>
            {tab === 'open' ? 'New orders appear here as soon as they are placed.' : 'No orders with this status yet.'}
          </Empty>
        </Card>
      ) : (
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((o) => (
            <li key={o.id}>
              <Card className="flex h-full flex-col overflow-hidden">
                <div className="flex items-start justify-between gap-4 p-5">
                  <div>
                    <p className="display tnum text-3xl tracking-[0.12em] text-ink-950">{o.pickupCode}</p>
                    <p className="tnum mt-1 text-[12px] text-ink-500">{dateTime(o.createdAt)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <OrderBadge status={o.status} />
                    <PaymentBadge status={o.paymentStatus} />
                  </div>
                </div>
                <div className="border-y hairline bg-white/60 px-5 py-3">
                  <p className="text-sm font-medium text-ink-950">{fullName(o.client)}</p>
                  <a href={`tel:${o.client.phoneNumber}`} className="tnum inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-brass-600">
                    <Phone className="size-3" /> {phone(o.client.phoneNumber)}
                  </a>
                </div>
                <ul className="flex-1 space-y-2 px-5 py-4">
                  {o.items.map((item) => (
                    <li key={item.productId} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink-800">
                        <span className="tnum mr-2 font-medium text-ink-950">{item.quantity}×</span>
                        {item.name}
                      </span>
                      <span className="tnum shrink-0 text-ink-500">{money(item.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-baseline justify-between border-t hairline px-5 py-3">
                  <span className="text-[13px] text-ink-500">Total</span>
                  <span className="display tnum text-2xl text-ink-950">{money(o.totalPrice)}</span>
                </div>
                {(o.actions.advanceTo || o.actions.markPaid || o.actions.refund || o.actions.cancel) && (
                  <div className="flex flex-wrap gap-2 border-t hairline bg-ink-50/60 px-5 py-3.5">
                    {o.actions.advanceTo && (
                      <Button size="sm" loading={busy && advance.variables?.id === o.id} onClick={() => advance.mutate({ id: o.id, status: o.actions.advanceTo! })}>
                        {ADVANCE_LABEL[o.actions.advanceTo]} <ArrowRight className="size-3.5" />
                      </Button>
                    )}
                    {o.actions.markPaid && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => payment.mutate({ id: o.id, paymentStatus: 'PAID' })}>
                        <Banknote className="size-3.5" /> Mark paid
                      </Button>
                    )}
                    {o.actions.refund && (o.status === 'RECEIVED' || o.status === 'CANCELED') && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => payment.mutate({ id: o.id, paymentStatus: 'REFUNDED' })}>
                        <RotateCcw className="size-3.5" /> Refund
                      </Button>
                    )}
                    {o.actions.cancel && (
                      <Button size="sm" variant="ghost" onClick={() => setCanceling(o)}>
                        <X className="size-3.5" /> Cancel
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog open={!!canceling} onClose={() => setCanceling(null)} onConfirm={() => canceling && cancel.mutate(canceling.id)} title="Cancel this order?" confirmLabel="Cancel order" danger loading={cancel.isPending}>
        Order {canceling?.pickupCode} for {canceling && fullName(canceling.client)} will be canceled and its items returned to stock.
        {canceling?.paymentStatus === 'PAID' && ' An online payment is refunded automatically; cash is handed back at the desk.'}
      </ConfirmDialog>
      <NewOrderDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
