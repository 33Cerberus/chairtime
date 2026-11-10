import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, CalendarPlus, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, Barber, DayOfWeek, errorMessage, ScheduleException, Service, TimeRange, WorkingHours } from '../lib/api';
import { addDays, DAYS, dateTime, duration, isoDate, isoDayLong, money, titleCase } from '../lib/format';
import { Badge, Button, cn, Input, Notice, Segmented, Select, Skeleton, Textarea, toast } from './ui';

const TIMES = Array.from({ length: (23 - 6) * 4 + 1 }, (_, i) => {
  const m = 6 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

interface Stranded {
  id: string;
  startAt: string;
  service: string;
  client: string;
}

/** A schedule change the server refused because bookings would be left outside working hours. */
function InTheWay({ error }: { error: unknown }) {
  if (!error) return null;
  const stranded = error instanceof ApiError && error.code === 'BOOKINGS_IN_THE_WAY' ? ((error.details as { bookings: Stranded[] })?.bookings ?? []) : null;
  return (
    <Notice tone="bad">
      <p>{errorMessage(error)}</p>
      {stranded && (
        <ul className="tnum mt-2 space-y-0.5 text-[13px]">
          {stranded.slice(0, 6).map((b) => (
            <li key={b.id}>
              {dateTime(b.startAt)} — {b.client}, {b.service}
            </li>
          ))}
          {stranded.length > 6 && <li>…and {stranded.length - 6} more</li>}
        </ul>
      )}
    </Notice>
  );
}

// ---- Public profile ---------------------------------------------------------------------------

export function ProfileEditor({ barberId }: { barberId: string }) {
  const queryClient = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const barber = useQuery({ queryKey: ['barbers', barberId], queryFn: () => api<Barber>(`/barbers/${barberId}`) });
  const [form, setForm] = useState({ title: '', bio: '' });

  useEffect(() => {
    if (barber.data) setForm({ title: barber.data.title ?? '', bio: barber.data.bio ?? '' });
  }, [barber.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (b: Barber) => {
    queryClient.setQueryData(['barbers', barberId], b);
    queryClient.invalidateQueries({ queryKey: ['barbers'], exact: true });
  };
  const save = useMutation({
    mutationFn: () => api<Barber>(`/barbers/${barberId}`, { method: 'PATCH', body: form }),
    onSuccess: (b) => {
      refresh(b);
      toast.success('Profile saved.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const upload = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return api<Barber>(`/barbers/${barberId}/photo`, { method: 'POST', form });
    },
    onSuccess: (b) => {
      refresh(b);
      toast.success('Photo updated.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removePhoto = useMutation({
    mutationFn: () => api<Barber>(`/barbers/${barberId}`, { method: 'PATCH', body: { photoUrl: null } }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!barber.data) return <Skeleton className="h-72" />;
  const b = barber.data;

  return (
    <div className="grid gap-8 sm:grid-cols-[200px_1fr]">
      <div>
        <div className="aspect-[4/5] overflow-hidden rounded-3xl bg-ink-100">
          {b.photoUrl ? (
            <img src={b.photoUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center bg-gradient-to-br from-ink-700 to-ink-950">
              <span className="display text-6xl text-brass-300 italic">
                {b.firstName[0]}
                {b.lastName?.[0]}
              </span>
            </div>
          )}
        </div>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
        <Button size="sm" variant="outline" className="mt-3 w-full" loading={upload.isPending} onClick={() => file.current?.click()}>
          <ImagePlus className="size-3.5" /> {b.photoUrl ? 'Replace photo' : 'Upload photo'}
        </Button>
        {b.photoUrl && (
          <Button size="sm" variant="ghost" className="mt-1.5 w-full" disabled={removePhoto.isPending} onClick={() => removePhoto.mutate()}>
            Remove
          </Button>
        )}
        <p className="mt-2 text-center text-[12px] text-ink-400">JPEG, PNG or WebP · up to 5 MB · portrait works best</p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Input label="Title" value={form.title} maxLength={80} placeholder="Master barber · fades & sharp lines" onChange={(e) => setForm({ ...form, title: e.target.value })} hint="One line under the name." />
        <Textarea label="About" value={form.bio} maxLength={1000} className="min-h-40" onChange={(e) => setForm({ ...form, bio: e.target.value })} hint="Shown on the public profile. Contact details are never public." />
        <Button type="submit" loading={save.isPending}>
          Save profile
        </Button>
      </form>
    </div>
  );
}

// ---- Services and prices ----------------------------------------------------------------------

export function OffersEditor({ barberId, readOnly }: { barberId: string; readOnly?: boolean }) {
  const queryClient = useQueryClient();
  const barber = useQuery({ queryKey: ['barbers', barberId], queryFn: () => api<Barber>(`/barbers/${barberId}`) });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api<Service[]>('/services'), enabled: !readOnly });
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState({ serviceId: '', price: '' });

  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['barbers'] });
    queryClient.invalidateQueries({ queryKey: ['services'] });
    toast.success(message);
  };
  const fail = (e: unknown) => toast.error(errorMessage(e));
  const toGrosze = (zl: string) => Math.round(Number(zl.replace(',', '.')) * 100);
  const valid = (zl: string) => zl.trim() !== '' && Number.isFinite(toGrosze(zl)) && toGrosze(zl) >= 0;

  const setPrice = useMutation({
    mutationFn: ({ serviceId, price }: { serviceId: string; price: number }) => api(`/barbers/${barberId}/services/${serviceId}`, { method: 'PATCH', body: { price } }),
    onSuccess: (_, v) => {
      setPrices(({ [v.serviceId]: _gone, ...rest }) => rest);
      done('Price updated. Existing bookings keep the price they were made at.');
    },
    onError: fail,
  });
  const remove = useMutation({ mutationFn: (serviceId: string) => api(`/barbers/${barberId}/services/${serviceId}`, { method: 'DELETE' }), onSuccess: () => done('Service removed from this barber.'), onError: fail });
  const assign = useMutation({
    mutationFn: () => api(`/barbers/${barberId}/services`, { method: 'POST', body: { serviceId: adding.serviceId, price: toGrosze(adding.price) } }),
    onSuccess: () => {
      setAdding({ serviceId: '', price: '' });
      done('Service added.');
    },
    onError: fail,
  });

  if (!barber.data) return <Skeleton className="h-48" />;
  const offers = barber.data.services;
  const unassigned = (services.data ?? []).filter((s) => s.isActive && !offers.some((o) => o.serviceId === s.id));

  return (
    <div className="space-y-5">
      {offers.length === 0 && <p className="text-sm text-ink-500">No services yet. {readOnly ? 'The front desk assigns them.' : 'Add the first one below.'}</p>}
      <ul className="divide-y divide-ink-900/8 overflow-hidden rounded-2xl border hairline bg-white">
        {offers.map((o) => {
          const draft = prices[o.serviceId];
          const dirty = draft !== undefined && valid(draft) && toGrosze(draft) !== o.price;
          return (
            <li key={o.serviceId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-[15px] font-medium text-ink-950">
                  {o.name} {!o.isActive && <Badge className="ml-1.5">Off sale</Badge>}
                </p>
                <p className="tnum text-[13px] text-ink-500">{duration(o.duration)}</p>
              </div>
              {readOnly ? (
                <p className="tnum text-[15px] font-medium text-ink-950">{money(o.price)}</p>
              ) : (
                <>
                  <label className="relative block w-28">
                    <span className="sr-only">Price of {o.name} in złoty</span>
                    <input
                      inputMode="decimal"
                      value={draft ?? String(o.price / 100)}
                      onChange={(e) => setPrices({ ...prices, [o.serviceId]: e.target.value })}
                      className="tnum h-10 w-full rounded-xl border border-ink-900/12 bg-white pr-9 pl-3 text-right text-[15px] focus:border-brass-500 focus:ring-4 focus:ring-brass-400/20 focus:outline-none"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-ink-400">zł</span>
                  </label>
                  <Button size="sm" disabled={!dirty} loading={setPrice.isPending && setPrice.variables?.serviceId === o.serviceId} onClick={() => setPrice.mutate({ serviceId: o.serviceId, price: toGrosze(draft!) })}>
                    Save
                  </Button>
                  <button type="button" aria-label={`Remove ${o.name}`} onClick={() => remove.mutate(o.serviceId)} className="flex size-9 items-center justify-center rounded-full text-ink-400 hover:bg-bad-50 hover:text-bad-600">
                    <Trash2 className="size-4" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {!readOnly && unassigned.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-dashed border-ink-900/15 p-4">
          <div className="min-w-48 flex-1">
            <Select label="Add a service" value={adding.serviceId} onChange={(e) => setAdding({ ...adding, serviceId: e.target.value })}>
              <option value="">Choose…</option>
              {unassigned.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {duration(s.duration)}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-32">
            <Input label="Price, zł" inputMode="decimal" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} className="tnum text-right" />
          </div>
          <Button disabled={!adding.serviceId || !valid(adding.price)} loading={assign.isPending} onClick={() => assign.mutate()}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
      )}
      {readOnly && <p className="text-[13px] text-ink-500">Services and prices are managed by the front desk.</p>}
    </div>
  );
}

// ---- Weekly working hours ---------------------------------------------------------------------

export function HoursEditor({ barberId }: { barberId: string }) {
  const queryClient = useQueryClient();
  const hours = useQuery({ queryKey: ['working-hours', barberId], queryFn: () => api<WorkingHours>(`/barbers/${barberId}/working-hours`) });
  const [days, setDays] = useState<Record<DayOfWeek, TimeRange[]> | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (hours.data) {
      setDays(structuredClone(hours.data.days));
      setDirty(false);
    }
  }, [hours.data]);

  const save = useMutation({
    mutationFn: () =>
      api<WorkingHours>(`/barbers/${barberId}/working-hours`, {
        method: 'PUT',
        body: { intervals: DAYS.flatMap((d) => days![d].map((r) => ({ dayOfWeek: d, ...r }))) },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['working-hours', barberId], data);
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
      queryClient.invalidateQueries({ queryKey: ['slot-calendar'] });
      toast.success('Working hours saved.');
    },
  });

  if (!days) return <Skeleton className="h-96" />;
  const change = (day: DayOfWeek, ranges: TimeRange[]) => {
    setDays({ ...days, [day]: ranges });
    setDirty(true);
    save.reset();
  };

  return (
    <div className="space-y-5">
      <ul className="divide-y divide-ink-900/8 overflow-hidden rounded-2xl border hairline bg-white">
        {DAYS.map((day) => {
          const ranges = days[day];
          return (
            <li key={day} className="grid gap-x-5 gap-y-2 px-4 py-3.5 sm:grid-cols-[130px_1fr]">
              <div className="flex items-center justify-between sm:block">
                <p className="text-[15px] font-medium text-ink-950">{titleCase(day)}</p>
                {ranges.length === 0 && <p className="text-[13px] text-ink-400">Day off</p>}
              </div>
              <div className="space-y-2">
                {ranges.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {(['startTime', 'endTime'] as const).map((k) => (
                      <select
                        key={k}
                        aria-label={`${titleCase(day)} ${k === 'startTime' ? 'from' : 'until'}`}
                        value={r[k]}
                        onChange={(e) => change(day, ranges.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                        className="tnum h-10 rounded-xl border border-ink-900/12 bg-white px-3 text-sm focus:border-brass-500 focus:outline-none"
                      >
                        {TIMES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    ))}
                    <button type="button" aria-label="Remove these hours" onClick={() => change(day, ranges.filter((_, j) => j !== i))} className="flex size-9 items-center justify-center rounded-full text-ink-400 hover:bg-ink-900/6 hover:text-ink-950">
                      <X className="size-4" />
                    </button>
                    {i === 0 && ranges.length > 1 && <span className="hidden text-[12px] text-ink-400 sm:inline">a gap between rows is a break</span>}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const last = ranges[ranges.length - 1];
                    const start = last ? TIMES[Math.min(TIMES.indexOf(last.endTime) + 4, TIMES.length - 5)] : '10:00';
                    const end = last ? TIMES[Math.min(TIMES.indexOf(start) + 16, TIMES.length - 1)] : '18:00';
                    change(day, [...ranges, { startTime: start, endTime: end }]);
                  }}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brass-600 hover:text-brass-700"
                >
                  <Plus className="size-3.5" /> {ranges.length ? 'Add hours after a break' : 'Add working hours'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <InTheWay error={save.error} />
      <div className="flex items-center gap-3">
        <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          Save working hours
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => { setDays(structuredClone(hours.data!.days)); setDirty(false); save.reset(); }}>
            Undo changes
          </Button>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-ink-500">
        Hours repeat every week, in Warsaw time. A lunch break is simply the gap between two rows. Hours cannot be removed from under
        upcoming bookings — move or cancel those first.
      </p>
    </div>
  );
}

// ---- Exceptions: time off and extra hours -----------------------------------------------------

export function ExceptionsEditor({ barberId }: { barberId: string }) {
  const queryClient = useQueryClient();
  const today = isoDate();
  const list = useQuery({ queryKey: ['exceptions', barberId], queryFn: () => api<ScheduleException[]>(`/barbers/${barberId}/exceptions`, { query: { from: today } }) });
  const [form, setForm] = useState({ type: 'BLOCKING' as 'BLOCKING' | 'ADDITIONAL', date: addDays(today, 1), wholeDay: true, startTime: '10:00', endTime: '14:00', reason: '' });
  const partial = form.type === 'ADDITIONAL' || !form.wholeDay;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['exceptions', barberId] });
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
    queryClient.invalidateQueries({ queryKey: ['slots'] });
    queryClient.invalidateQueries({ queryKey: ['slot-calendar'] });
  };
  const create = useMutation({
    mutationFn: () =>
      api<ScheduleException>(`/barbers/${barberId}/exceptions`, {
        method: 'POST',
        body: { date: form.date, type: form.type, ...(partial ? { startTime: form.startTime, endTime: form.endTime } : {}), ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) },
      }),
    onSuccess: () => {
      refresh();
      setForm((f) => ({ ...f, reason: '' }));
      toast.success(form.type === 'BLOCKING' ? 'Time off added.' : 'Extra hours added.');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/barbers/${barberId}/exceptions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success('Removed.');
    },
  });

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-[15px] font-medium text-ink-950">Coming up</h3>
        {list.isLoading ? (
          <Skeleton className="h-32" />
        ) : list.data?.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink-900/15 px-4 py-8 text-center text-sm text-ink-500">Nothing planned. The weekly hours apply every day.</p>
        ) : (
          <ul className="space-y-2.5">
            {list.data?.map((e) => (
              <li key={e.id} className="flex items-center gap-3.5 rounded-2xl border hairline bg-white px-4 py-3">
                <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', e.type === 'BLOCKING' ? 'bg-ink-900/6 text-ink-600' : 'bg-brass-100 text-brass-700')}>
                  {e.type === 'BLOCKING' ? <CalendarOff className="size-[18px]" /> : <CalendarPlus className="size-[18px]" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-ink-950">{isoDayLong(e.date)}</p>
                  <p className="tnum text-[13px] text-ink-500">
                    {e.type === 'BLOCKING' ? 'Time off' : 'Extra hours'} · {e.startTime ? `${e.startTime}–${e.endTime}` : 'whole day'}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </p>
                </div>
                <button type="button" aria-label="Remove" disabled={remove.isPending} onClick={() => remove.mutate(e.id)} className="flex size-9 items-center justify-center rounded-full text-ink-400 hover:bg-bad-50 hover:text-bad-600">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <InTheWay error={remove.error} />
        </div>
      </div>

      <form
        className="space-y-4 rounded-2xl border hairline bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h3 className="text-[15px] font-medium text-ink-950">Add a one-off change</h3>
        <Segmented
          value={form.type}
          onChange={(type) => { setForm({ ...form, type }); create.reset(); }}
          options={[
            { value: 'BLOCKING', label: 'Time off' },
            { value: 'ADDITIONAL', label: 'Extra hours' },
          ]}
        />
        <Input label="Date" type="date" min={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        {form.type === 'BLOCKING' && (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-700">
            <input type="checkbox" className="size-4 accent-ink-900" checked={form.wholeDay} onChange={(e) => setForm({ ...form, wholeDay: e.target.checked })} />
            The whole day
          </label>
        )}
        {partial && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="From" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })}>
              {TIMES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
            <Select label="Until" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })}>
              {TIMES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </div>
        )}
        <Input label="Note (optional, staff only)" maxLength={200} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={form.type === 'BLOCKING' ? 'e.g. dentist, holiday' : 'e.g. covering Saturday'} />
        <InTheWay error={create.error} />
        <Button type="submit" loading={create.isPending} disabled={!form.date}>
          {form.type === 'BLOCKING' ? 'Add time off' : 'Add extra hours'}
        </Button>
      </form>
    </div>
  );
}
