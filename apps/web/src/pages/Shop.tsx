import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Minus, PackageCheck, Plus, Search, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAddToCart } from '../components/CartDrawer';
import { Badge, Button, ButtonLink, cn, Empty, PageLoader, Skeleton } from '../components/ui';
import { api, ApiError, Product, ProductPage } from '../lib/api';
import { money } from '../lib/format';

function StockBadge({ product }: { product: Product }) {
  if (product.stock === 0) return <Badge tone="dark">Sold out</Badge>;
  if (product.stock <= 5) return <Badge tone="warn">Only {product.stock} left</Badge>;
  return null;
}

export function ShopPage() {
  const [category, setCategory] = useState('');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const { add, pending } = useAddToCart();

  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  const products = useQuery({
    queryKey: ['products', { category, search }],
    queryFn: () => api<ProductPage>('/products', { query: { category, search, limit: 48 } }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <header className="mx-auto max-w-7xl px-5 pt-14 pb-10 sm:px-8 sm:pt-20">
        <p className="eyebrow mb-4">Shop</p>
        <h1 className="display max-w-4xl animate-rise text-6xl text-ink-950 sm:text-8xl">
          The good stuff, <span className="italic">to go.</span>
        </h1>
        <p className="mt-6 max-w-xl animate-rise text-lg leading-relaxed text-ink-500 [animation-delay:100ms]">
          The same products that sit at our stations. Order online, collect at the shop — usually ready the same day.
        </p>
      </header>

      <section className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]" role="tablist" aria-label="Category">
            {['', ...(products.data?.categories ?? [])].map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={category === c}
                onClick={() => setCategory(c)}
                className={cn(
                  'h-10 shrink-0 rounded-full px-4.5 text-sm font-medium transition-colors',
                  category === c ? 'bg-ink-900 text-paper' : 'border border-ink-900/12 bg-card text-ink-700 hover:border-ink-900/40',
                )}
              >
                {c || 'Everything'}
              </button>
            ))}
          </div>
          <label className="relative block w-full sm:w-64">
            <span className="sr-only">Search products</span>
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search"
              className="h-10 w-full rounded-full border border-ink-900/12 bg-card pr-4 pl-10 text-sm placeholder:text-ink-400 focus:border-brass-500 focus:ring-4 focus:ring-brass-400/20 focus:outline-none"
            />
          </label>
        </div>

        {products.isLoading ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[5/6] !rounded-[28px]" />
            ))}
          </div>
        ) : products.data?.items.length === 0 ? (
          <Empty icon={<Search />} title="Nothing matches">
            Try a different word, or clear the filter to see everything.
          </Empty>
        ) : (
          <div className={cn('grid grid-cols-2 gap-x-5 gap-y-12 transition-opacity md:grid-cols-3 lg:grid-cols-4', products.isPlaceholderData && 'opacity-60')}>
            {products.data?.items.map((p, i) => (
              <article key={p.id} className="group animate-rise" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
                <Link to={`/shop/${p.id}`} className="relative block aspect-[5/6] overflow-hidden rounded-[28px] bg-ink-100">
                  {p.photoUrls[0] && (
                    <img
                      src={p.photoUrls[0]}
                      alt={p.name}
                      loading="lazy"
                      className={cn('size-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.05]', p.stock === 0 && 'opacity-60 grayscale-[35%]')}
                    />
                  )}
                  <span className="absolute top-3.5 left-3.5">
                    <StockBadge product={p} />
                  </span>
                </Link>
                <div className="mt-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {p.category && <p className="text-[12px] text-ink-400">{p.category}</p>}
                    <h2 className="mt-0.5 text-[15px] leading-snug font-medium text-ink-950">
                      <Link to={`/shop/${p.id}`} className="hover:underline hover:underline-offset-4">
                        {p.name}
                      </Link>
                    </h2>
                    <p className="tnum mt-1 text-[15px] text-ink-600">{money(p.price)}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Add ${p.name} to cart`}
                    disabled={p.stock === 0 || pending}
                    onClick={() => add(p.id)}
                    className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border border-ink-900/12 text-ink-800 transition-all hover:border-ink-900 hover:bg-ink-900 hover:text-paper disabled:pointer-events-none disabled:opacity-30"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export function ProductPage_() {
  const { id } = useParams();
  const [photo, setPhoto] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const { add, pending } = useAddToCart();
  const product = useQuery({
    queryKey: ['products', id],
    queryFn: () => api<Product>(`/products/${id}`),
    retry: (count, e) => !(e instanceof ApiError && e.status === 404) && count < 2,
  });

  useEffect(() => {
    setPhoto(0);
    setQuantity(1);
  }, [id]);

  if (product.isLoading) return <PageLoader />;
  if (!product.data) {
    return (
      <Empty title="This product is gone" action={<ButtonLink to="/shop">Back to the shop</ButtonLink>} className="py-32">
        It may have been discontinued.
      </Empty>
    );
  }
  const p = product.data;
  const soldOut = p.stock === 0;

  return (
    <div className="mx-auto max-w-7xl px-5 pt-10 sm:px-8 sm:pt-14">
      <Link to="/shop" className="mb-8 inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-950">
        <ArrowLeft className="size-4" /> Shop
      </Link>
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-20">
        <div className="animate-rise">
          <div className="aspect-[5/6] overflow-hidden rounded-[32px] bg-ink-100">
            {p.photoUrls[photo] && <img key={photo} src={p.photoUrls[photo]} alt={p.name} className="size-full animate-fade object-cover" />}
          </div>
          {p.photoUrls.length > 1 && (
            <div className="mt-4 flex gap-3">
              {p.photoUrls.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  aria-label={`Photo ${i + 1}`}
                  aria-pressed={photo === i}
                  onClick={() => setPhoto(i)}
                  className={cn('size-20 overflow-hidden rounded-2xl bg-ink-100 transition-all', photo === i ? 'ring-2 ring-ink-900 ring-offset-2 ring-offset-paper' : 'opacity-70 hover:opacity-100')}
                >
                  <img src={url} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:py-8">
          {p.category && <p className="eyebrow mb-4 text-brass-600">{p.category}</p>}
          <h1 className="display animate-rise text-6xl text-ink-950 sm:text-7xl">{p.name}</h1>
          <div className="mt-6 flex items-center gap-4">
            <p className="display tnum text-4xl text-ink-950">{money(p.price)}</p>
            <StockBadge product={p} />
          </div>
          <p className="mt-7 max-w-lg text-[17px] leading-relaxed text-ink-600">{p.description}</p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <div className="inline-flex h-13 items-center rounded-full border border-ink-900/15 bg-card">
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => q - 1)}
                className="flex size-13 items-center justify-center rounded-full text-ink-600 hover:text-ink-950 disabled:opacity-30"
              >
                <Minus className="size-4" />
              </button>
              <span className="tnum w-8 text-center font-medium" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={quantity >= Math.min(p.stock, 99)}
                onClick={() => setQuantity((q) => q + 1)}
                className="flex size-13 items-center justify-center rounded-full text-ink-600 hover:text-ink-950 disabled:opacity-30"
              >
                <Plus className="size-4" />
              </button>
            </div>
            <Button size="lg" className="flex-1 sm:flex-none" disabled={soldOut} loading={pending} onClick={() => add(p.id, quantity)}>
              <ShoppingBag className="size-4" /> {soldOut ? 'Sold out' : 'Add to cart'}
            </Button>
          </div>

          <div className="mt-10 flex items-start gap-3.5 rounded-2xl border hairline bg-card p-5">
            <PackageCheck className="mt-0.5 size-5 shrink-0 text-brass-600" />
            <p className="text-sm leading-relaxed text-ink-600">
              <strong className="font-medium text-ink-950">Collect at the shop.</strong> We will message you when your order is
              ready, usually within a few hours. Pay online or when you pick it up.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
