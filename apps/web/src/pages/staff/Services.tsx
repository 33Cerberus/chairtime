import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Pencil, Plus, Scissors } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, cn, Dialog, Empty, Input, Notice, PageHeader, Select, Skeleton, Textarea, toast } from '../../components/ui';
import { api, errorMessage, Service } from '../../lib/api';
import { duration, money } from '../../lib/format';

const DURATIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);

function ServiceDialog({ service, open, onClose }: { service: Service | null; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', description: '', duration: 45, isActive: true });

  useEffect(() => {
    if (open) setForm({ name: service?.name ?? '', description: service?.description ?? '', duration: service?.duration ?? 45, isActive: service?.isActive ?? true });
  }, [open, service]);

  const save = useMutation({
    mutationFn: () =>
      service
        ? api<Service>(`/services/${service.id}`, { method: 'PATCH', body: form })
        : api<Service>('/services', { method: 'POST', body: { name: form.name, description: form.description || undefined, duration: form.duration } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      queryClient.invalidateQueries({ queryKey: ['barbers'] });
      toast.success(service ? 'Service updated.' : 'Service created. Assign it to barbers under Team to put it on sale.');
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={service ? 'Edit service' : 'New service'}
      description="The price is set per barber, under Team."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Discard
          </Button>
          <Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
            {service ? 'Save changes' : 'Create service'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <Input label="Name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        <Textarea label="Description" value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} hint="One or two sentences. Shown to clients on the menu." />
        <Select label="Length" value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} hint="Bookings already made keep the length they were booked with.">
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {duration(d)}
            </option>
          ))}
        </Select>
        {service && (
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border hairline bg-white p-4">
            <input type="checkbox" className="mt-1 size-4 accent-ink-900" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            <span className="text-sm leading-relaxed text-ink-700">
              <span className="font-medium text-ink-950">On sale</span>
              <br />
              Turn this off to stop new bookings. Existing bookings stay as they are; services are never deleted.
            </span>
          </label>
        )}
      </div>
    </Dialog>
  );
}

export default function StaffServices() {
  const services = useQuery({ queryKey: ['services'], queryFn: () => api<Service[]>('/services') });
  const [editing, setEditing] = useState<Service | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="Shop setup"
        title="Services"
        action={
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" /> New service
          </Button>
        }
      >
        The shop-wide menu. Each service has one length for everyone; prices are set per barber.
      </PageHeader>

      <Card className="overflow-hidden">
        {services.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : services.data?.length === 0 ? (
          <Empty icon={<Scissors />} title="No services yet">
            Create the first one to start building the menu.
          </Empty>
        ) : (
          <ul className="divide-y divide-ink-900/6">
            {services.data?.map((s) => (
              <li key={s.id} className={cn('flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 sm:px-6', !s.isActive && 'opacity-55')}>
                <div className="min-w-0 flex-1 basis-64">
                  <p className="display text-2xl text-ink-950">{s.name}</p>
                  {s.description && <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-500">{s.description}</p>}
                </div>
                <p className="tnum flex w-24 items-center gap-1.5 text-sm text-ink-600">
                  <Clock className="size-3.5" /> {duration(s.duration)}
                </p>
                <p className="tnum w-36 text-sm text-ink-800">
                  {s.priceFrom === null ? <span className="text-ink-400">No barber yet</span> : s.priceFrom === s.priceTo ? money(s.priceFrom) : `${money(s.priceFrom)} – ${money(s.priceTo!)}`}
                </p>
                <div className="w-28">
                  {!s.isActive ? <Badge>Off sale</Badge> : s.barberIds.length === 0 ? <Badge tone="warn">Unassigned</Badge> : <Badge tone="ok">{s.barberIds.length} barber{s.barberIds.length > 1 ? 's' : ''}</Badge>}
                </div>
                <Button size="sm" variant="outline" onClick={() => { setEditing(s); setOpen(true); }}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ServiceDialog service={editing} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
