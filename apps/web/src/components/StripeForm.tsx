import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { FormEvent, useMemo, useState } from 'react';
import { api, Booking, Order } from '../lib/api';
import { money } from '../lib/format';
import type { PayTarget } from './PaymentDialog';
import { Button, Notice } from './ui';

interface Props {
  publishableKey: string;
  clientSecret: string;
  amount: number;
  target: PayTarget;
  onPaid: () => void;
}

/** Loaded only when the server reports Stripe as the provider, so Stripe.js is not shipped otherwise. */
export default function StripeForm(props: Props) {
  const stripe = useMemo(() => loadStripe(props.publishableKey), [props.publishableKey]);
  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: props.clientSecret,
        appearance: {
          theme: 'flat',
          variables: { colorPrimary: '#a98034', colorText: '#171411', borderRadius: '12px', fontFamily: 'system-ui, sans-serif' },
        },
      }}
    >
      <Form {...props} />
    </Elements>
  );
}

function Form({ amount, target, onPaid }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The booking or order turns PAID when Stripe's webhook lands, a moment after the card clears. */
  const waitForWebhook = async () => {
    for (let i = 0; i < 15; i++) {
      const record = await api<Booking | Order>(`/${target.kind}/${target.id}`);
      if (record.paymentStatus === 'PAID') return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (result.error) {
      setError(result.error.message ?? 'The payment did not go through.');
      setBusy(false);
      return;
    }
    await waitForWebhook();
    setBusy(false);
    onPaid();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement />
      {error && <Notice tone="bad">{error}</Notice>}
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!stripe}>
        Pay {money(amount)}
      </Button>
    </form>
  );
}
