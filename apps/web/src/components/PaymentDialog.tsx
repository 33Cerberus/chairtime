import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, FlaskConical, Lock } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { api, errorMessage, PaymentStart } from '../lib/api';
import { money } from '../lib/format';
import { Button, Dialog, Notice, Pole, toast } from './ui';

const StripeForm = lazy(() => import('./StripeForm'));

export interface PayTarget {
  kind: 'bookings' | 'orders';
  id: string;
  label: string;
  amount: number;
}

/**
 * Online payment. With Stripe configured on the server this renders Stripe's Payment Element;
 * otherwise the API runs its mock provider and this shows a test checkout that settles instantly.
 */
export function PaymentDialog({ target, onClose }: { target: PayTarget | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const start = useQuery({
    queryKey: ['payment-start', target?.kind, target?.id],
    queryFn: () => api<PaymentStart>(`/${target!.kind}/${target!.id}/payments`, { method: 'POST' }),
    enabled: !!target,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    toast.success(message);
    onClose();
  };

  const mock = useMutation({
    mutationFn: (outcome: 'succeeded' | 'failed') =>
      api<{ status: string }>(`/payments/${start.data!.paymentId}/mock-confirm`, { method: 'POST', body: { outcome } }),
    onSuccess: (r) => {
      if (r.status === 'SUCCEEDED') done('Payment received. Thank you!');
      else {
        toast.error('The card was declined. Nothing was charged.');
        queryClient.removeQueries({ queryKey: ['payment-start'] });
        onClose();
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={!!target} onClose={onClose} title="Pay online" description={target?.label} size="sm">
      {target && (
        <div className="space-y-5">
          <div className="flex items-baseline justify-between rounded-2xl bg-ink-900 px-5 py-4 text-paper">
            <span className="text-sm text-ink-300">Total due</span>
            <span className="display tnum text-3xl">{money(target.amount)}</span>
          </div>

          {start.isLoading && (
            <div className="flex justify-center py-8">
              <Pole />
            </div>
          )}
          {start.error && <Notice tone="bad">{errorMessage(start.error)}</Notice>}

          {start.data?.provider === 'mock' && (
            <>
              <Notice tone="info">
                <strong className="font-medium">Test checkout.</strong> Stripe is not configured on this server, so no real
                card is needed and nothing is charged.
              </Notice>
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-ink-700 to-ink-950 p-5 text-paper shadow-soft">
                <div className="flex items-center justify-between">
                  <FlaskConical className="size-5 text-brass-300" />
                  <span className="eyebrow text-ink-300">Test card</span>
                </div>
                <p className="tnum mt-7 text-lg tracking-[0.18em]">4242 4242 4242 4242</p>
                <div className="mt-3 flex justify-between text-[12px] text-ink-300">
                  <span>CHAIRTIME DEMO</span>
                  <span className="tnum">12 / 34</span>
                </div>
              </div>
              <div className="space-y-2.5">
                <Button className="w-full" size="lg" loading={mock.isPending && mock.variables === 'succeeded'} onClick={() => mock.mutate('succeeded')}>
                  <CreditCard className="size-4" /> Pay {money(target.amount)}
                </Button>
                <Button className="w-full" variant="ghost" loading={mock.isPending && mock.variables === 'failed'} onClick={() => mock.mutate('failed')}>
                  Simulate a declined card
                </Button>
              </div>
            </>
          )}

          {start.data?.provider === 'stripe' &&
            (start.data.publishableKey && start.data.clientSecret ? (
              <Suspense
                fallback={
                  <div className="flex justify-center py-8">
                    <Pole />
                  </div>
                }
              >
                <StripeForm
                  publishableKey={start.data.publishableKey}
                  clientSecret={start.data.clientSecret}
                  amount={target.amount}
                  target={target}
                  onPaid={() => done('Payment received. Thank you!')}
                />
              </Suspense>
            ) : (
              <Notice tone="bad">Online payment is not fully configured. Please pay at the shop.</Notice>
            ))}

          <p className="flex items-center justify-center gap-1.5 text-[12px] text-ink-400">
            <Lock className="size-3" /> Card details never touch our servers.
          </p>
        </div>
      )}
    </Dialog>
  );
}
