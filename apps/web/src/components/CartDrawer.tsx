import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { api, Cart, errorMessage, Order } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { PaymentDialog, PayTarget } from './PaymentDialog';
import { Button, ButtonLink, Dialog, Empty, Notice, Pole, toast } from './ui';

// A tiny store, so any page can open the cart without prop drilling.
let isOpen = false;
const subs = new Set<() => void>();
const set = (v: boolean) => {
  isOpen = v;
  subs.forEach((s) => s());
};
export const cartUi = { open: () => set(true), close: () => set(false) };

/** Adds to the cart, or sends a signed-out visitor to sign in first. */
export function useAddToCart() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) =>
      api<Cart>(`/cart/items/${productId}`, { method: 'PUT', body: { quantity } }),
    onSuccess: (cart) => {
      queryClient.setQueryData(['cart'], cart);
      cartUi.open();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return {
    pending: mutation.isPending,
    add: (productId: string, quantity = 1) => {
      if (!user) {
        toast.info('Sign in to start a cart.');
        navigate('/login', { state: { from: window.location.pathname } });
        return;
      }
      const inCart = queryClient.getQueryData<Cart>(['cart'])?.items.find((i) => i.productId === productId)?.quantity ?? 0;
      mutation.mutate({ productId, quantity: inCart + quantity });
    },
  };
}

export function CartDrawer() {
  const open = useSyncExternalStore(
    (l) => {
      subs.add(l);
      return () => subs.delete(l);
    },
    () => isOpen,
  );
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pay, setPay] = useState<PayTarget | null>(null);

  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api<Cart>('/cart'), enabled: !!user });
  const update = useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) =>
      quantity > 0
        ? api<Cart>(`/cart/items/${productId}`, { method: 'PUT', body: { quantity } })
        : api<Cart>(`/cart/items/${productId}`, { method: 'DELETE' }),
    onSuccess: (data) => queryClient.setQueryData(['cart'], data),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const order = useMutation({
    mutationFn: (_payNow: boolean) => api<Order>('/orders', { method: 'POST', body: {} }),
    onSuccess: (created, payNow) => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      cartUi.close();
      navigate('/account/orders');
      if (payNow) setPay({ kind: 'orders', id: created.id, label: `Order ${created.pickupCode}`, amount: created.totalPrice });
      else toast.success(`Order ${created.pickupCode} placed. Pay when you collect it.`);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  const data = cart.data;
  return (
    <>
      <Dialog
        open={open}
        onClose={cartUi.close}
        variant="sheet"
        title="Your cart"
        description="Collected at the shop — no delivery."
        footer={
          data && data.items.length > 0 ? (
            <div className="w-full space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink-500">Total</span>
                <span className="display tnum text-3xl text-ink-950">{money(data.total)}</span>
              </div>
              <Button className="w-full" size="lg" disabled={!data.canCheckout} loading={order.isPending && order.variables === true} onClick={() => order.mutate(true)}>
                Order and pay now
              </Button>
              <Button className="w-full" variant="outline" disabled={!data.canCheckout} loading={order.isPending && order.variables === false} onClick={() => order.mutate(false)}>
                Order, pay at pickup
              </Button>
            </div>
          ) : undefined
        }
      >
        {cart.isLoading ? (
          <div className="flex justify-center py-16">
            <Pole />
          </div>
        ) : !data || data.items.length === 0 ? (
          <Empty
            icon={<ShoppingBag />}
            title="Nothing here yet"
            action={
              <ButtonLink to="/shop" variant="outline" onClick={cartUi.close}>
                Browse the shop
              </ButtonLink>
            }
          >
            The products our barbers actually use, ready to take home.
          </Empty>
        ) : (
          <div>
            {!data.canCheckout && (
              <Notice tone="warn" className="mb-4">
                Some items are no longer available in this quantity. Adjust or remove them to continue.
              </Notice>
            )}
            <ul className="divide-y divide-ink-900/8">
              {data.items.map((item) => (
                <li key={item.productId} className="flex gap-4 py-4">
                  <div className="size-20 shrink-0 overflow-hidden rounded-2xl bg-ink-100">
                    {item.photoUrl && <img src={item.photoUrl} alt="" className="size-full object-cover" />}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[15px] leading-snug font-medium text-ink-950">{item.name}</p>
                      <p className="tnum shrink-0 text-[15px] font-medium text-ink-950">{money(item.lineTotal)}</p>
                    </div>
                    <p className="tnum mt-0.5 text-[13px] text-ink-500">{money(item.price)} each</p>
                    {!item.available && (
                      <p className="mt-1 text-[13px] text-bad-600">{item.stock === 0 ? 'Sold out' : `Only ${item.stock} left`}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <div className="inline-flex items-center rounded-full border border-ink-900/12">
                        <button
                          type="button"
                          aria-label={`One less ${item.name}`}
                          className="flex size-8 items-center justify-center rounded-full text-ink-600 hover:text-ink-950"
                          onClick={() => update.mutate({ productId: item.productId, quantity: item.quantity - 1 })}
                        >
                          <Minus className="size-3.5" />
                        </button>
                        <span className="tnum w-7 text-center text-sm font-medium">{item.quantity}</span>
                        <button
                          type="button"
                          aria-label={`One more ${item.name}`}
                          disabled={item.quantity >= item.stock}
                          className="flex size-8 items-center justify-center rounded-full text-ink-600 hover:text-ink-950 disabled:opacity-30"
                          onClick={() => update.mutate({ productId: item.productId, quantity: item.quantity + 1 })}
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        className="flex size-8 items-center justify-center rounded-full text-ink-400 hover:bg-bad-50 hover:text-bad-600"
                        onClick={() => update.mutate({ productId: item.productId, quantity: 0 })}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>
      <PaymentDialog target={pay} onClose={() => setPay(null)} />
    </>
  );
}
