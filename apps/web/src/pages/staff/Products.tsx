import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Minus, Pencil, Plus, Star, Store, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, cn, Dialog, Empty, Input, Notice, PageHeader, Skeleton, Textarea, toast } from '../../components/ui';
import { api, errorMessage, Product, ProductPage } from '../../lib/api';
import { money } from '../../lib/format';

const toGrosze = (zl: string) => Math.round(Number(zl.replace(',', '.')) * 100);

function ProductDialog({ productId, open, onClose, categories }: { productId: string | null; open: boolean; onClose: () => void; categories: string[] }) {
  const queryClient = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [id, setId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', category: '', price: '', stock: '0', isActive: true });

  const product = useQuery({ queryKey: ['products', id], queryFn: () => api<Product>(`/products/${id}`), enabled: open && !!id });
  const p = product.data;

  useEffect(() => {
    if (open) {
      setId(productId);
      if (!productId) setForm({ name: '', description: '', category: '', price: '', stock: '0', isActive: true });
    }
  }, [open, productId]);
  useEffect(() => {
    if (p) setForm({ name: p.name, description: p.description, category: p.category ?? '', price: String(p.price / 100), stock: String(p.stock), isActive: p.isActive });
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (updated: Product) => {
    queryClient.setQueryData(['products', updated.id], updated);
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };
  const body = () => ({
    name: form.name,
    description: form.description,
    price: toGrosze(form.price),
    stock: Number(form.stock),
    ...(form.category.trim() ? { category: form.category.trim() } : id ? { category: '' } : {}),
  });
  const save = useMutation({
    mutationFn: () => (id ? api<Product>(`/products/${id}`, { method: 'PATCH', body: { ...body(), isActive: form.isActive } }) : api<Product>('/products', { method: 'POST', body: body() })),
    onSuccess: (updated) => {
      refresh(updated);
      if (id) {
        toast.success('Product saved.');
        onClose();
      } else {
        // Stay open after creating, so photos can be added straight away.
        setId(updated.id);
        toast.success('Product created. Add a photo to finish.');
      }
    },
  });
  const upload = useMutation({
    mutationFn: (f: File) => {
      const data = new FormData();
      data.append('file', f);
      return api<Product>(`/products/${id}/photos`, { method: 'POST', form: data });
    },
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setPhotos = useMutation({
    mutationFn: (photoUrls: string[]) => api<Product>(`/products/${id}`, { method: 'PATCH', body: { photoUrls } }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const valid = form.name.trim() && form.description.trim() && Number.isFinite(toGrosze(form.price)) && toGrosze(form.price) >= 0 && Number.isInteger(Number(form.stock)) && Number(form.stock) >= 0;
  const photos = p?.photoUrls ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={id ? 'Edit product' : 'New product'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {id && !productId ? 'Done' : 'Discard'}
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {id ? 'Save changes' : 'Create product'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <Input label="Name" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Textarea label="Description" value={form.description} maxLength={2000} className="min-h-28" onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Price, zł" inputMode="decimal" className="tnum" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <Input label="In stock" inputMode="numeric" className="tnum" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value.replace(/\D/g, '') })} />
          <div>
            <Input label="Category" list="product-categories" value={form.category} maxLength={40} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <datalist id="product-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
        {id && (
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border hairline bg-white p-4">
            <input type="checkbox" className="mt-1 size-4 accent-ink-900" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            <span className="text-sm leading-relaxed text-ink-700">
              <span className="font-medium text-ink-950">On sale</span>
              <br />
              Turn this off to hide the product from the shop. It stays in past orders; products are never deleted.
            </span>
          </label>
        )}

        <div>
          <p className="mb-2 text-[13px] font-medium text-ink-700">Photos</p>
          {!id ? (
            <p className="rounded-2xl border border-dashed border-ink-900/15 px-4 py-6 text-center text-sm text-ink-500">Create the product first, then add photos.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {photos.map((url, i) => (
                <div key={url} className="group relative size-28 overflow-hidden rounded-2xl bg-ink-100">
                  <img src={url} alt="" className="size-full object-cover" />
                  {i === 0 && (
                    <Badge tone="dark" className="absolute top-1.5 left-1.5">
                      Cover
                    </Badge>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-ink-950/70 to-transparent p-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    {i > 0 && (
                      <button type="button" aria-label="Make this the cover photo" title="Make cover" onClick={() => setPhotos.mutate([url, ...photos.filter((u) => u !== url)])} className="flex size-7 items-center justify-center rounded-full bg-white/90 text-ink-900 hover:bg-white">
                        <Star className="size-3.5" />
                      </button>
                    )}
                    <button type="button" aria-label="Remove this photo" title="Remove" onClick={() => setPhotos.mutate(photos.filter((u) => u !== url))} className="flex size-7 items-center justify-center rounded-full bg-white/90 text-bad-600 hover:bg-white">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
              {photos.length < 8 && (
                <button type="button" onClick={() => file.current?.click()} disabled={upload.isPending} className="flex size-28 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-ink-900/20 text-[13px] text-ink-500 hover:border-ink-900/50 hover:text-ink-900">
                  <ImagePlus className="size-5" />
                  {upload.isPending ? 'Uploading…' : 'Add photo'}
                </button>
              )}
            </div>
          )}
          <p className="mt-2 text-[12px] text-ink-400">The first photo is the one shown in the shop. JPEG, PNG or WebP, up to 5 MB.</p>
        </div>
      </div>
    </Dialog>
  );
}

export default function StaffProducts() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const products = useQuery({ queryKey: ['products', 'staff'], queryFn: () => api<ProductPage>('/products', { query: { limit: 100 } }) });

  const restock = useMutation({
    mutationFn: ({ id, stock }: { id: string; stock: number }) => api<Product>(`/products/${id}`, { method: 'PATCH', body: { stock } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = products.data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Shop setup"
        title="Products"
        action={
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" /> New product
          </Button>
        }
      >
        The retail catalog and its stock. Stock goes down when an order is placed and comes back if it is canceled.
      </PageHeader>

      <Card className="overflow-hidden">
        {products.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <Empty icon={<Store />} title="No products yet">
            Add the first product to open the shop.
          </Empty>
        ) : (
          <ul className="divide-y divide-ink-900/6">
            {list.map((p) => (
              <li key={p.id} className={cn('flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5', !p.isActive && 'opacity-55')}>
                <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-ink-100">{p.photoUrls[0] && <img src={p.photoUrls[0]} alt="" className="size-full object-cover" />}</div>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-[15px] font-medium text-ink-950">{p.name}</p>
                  <p className="text-[13px] text-ink-500">{p.category ?? 'Uncategorised'}</p>
                </div>
                <p className="tnum w-20 text-[15px] text-ink-800">{money(p.price)}</p>
                <div className="flex items-center gap-2.5">
                  <div className="inline-flex items-center rounded-full border border-ink-900/12 bg-white">
                    <button type="button" aria-label={`One less ${p.name} in stock`} disabled={p.stock === 0 || restock.isPending} onClick={() => restock.mutate({ id: p.id, stock: p.stock - 1 })} className="flex size-8 items-center justify-center rounded-full text-ink-600 hover:text-ink-950 disabled:opacity-30">
                      <Minus className="size-3.5" />
                    </button>
                    <span className="tnum w-9 text-center text-sm font-medium">{p.stock}</span>
                    <button type="button" aria-label={`One more ${p.name} in stock`} disabled={restock.isPending} onClick={() => restock.mutate({ id: p.id, stock: p.stock + 1 })} className="flex size-8 items-center justify-center rounded-full text-ink-600 hover:text-ink-950 disabled:opacity-30">
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <span className="w-24">{!p.isActive ? <Badge>Off sale</Badge> : p.stock === 0 ? <Badge tone="bad">Sold out</Badge> : p.stock <= 5 ? <Badge tone="warn">Running low</Badge> : null}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => { setEditing(p.id); setOpen(true); }}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ProductDialog productId={editing} open={open} onClose={() => setOpen(false)} categories={products.data?.categories ?? []} />
    </>
  );
}
