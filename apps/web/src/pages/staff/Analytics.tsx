import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Card, cn, PageHeader, Segmented, Skeleton } from '../../components/ui';
import { api, BarberReport, RevenueSeries, Summary } from '../../lib/api';
import { addDays, duration, fullName, isoDate, isoDay, money, monthLong, percent } from '../../lib/format';

type Range = '7' | '30' | '90' | '365';

/** Change against the previous period. `inverse` marks metrics where lower is better. */
function Delta({ now, before, inverse }: { now: number; before: number; inverse?: boolean }) {
  if (!before && !now) return <span className="text-[12px] text-ink-400">no data before</span>;
  if (!before) return <span className="text-[12px] text-ink-400">new this period</span>;
  const change = (now - before) / before;
  const flat = Math.abs(change) < 0.005;
  const good = inverse ? change < 0 : change > 0;
  const Icon = flat ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('tnum inline-flex items-center gap-0.5 text-[12px] font-medium', flat ? 'text-ink-500' : good ? 'text-ok-600' : 'text-bad-600')}>
      <Icon className="size-3.5" />
      {Math.abs(change * 100).toFixed(change >= 10 ? 0 : 1)}%<span className="ml-1 font-normal text-ink-400">vs before</span>
    </span>
  );
}

function Tile({ label, value, now, before, inverse, featured }: { label: string; value: string; now: number; before: number; inverse?: boolean; featured?: boolean }) {
  return (
    <Card className={cn('p-5 sm:p-6', featured && 'grain relative isolate overflow-hidden !border-transparent !bg-ink-900 text-paper sm:col-span-2')}>
      <p className={cn('text-[13px]', featured ? 'text-ink-300' : 'text-ink-500')}>{label}</p>
      <p className={cn('display tnum mt-2', featured ? 'text-6xl sm:text-7xl' : 'text-4xl text-ink-950')}>{value}</p>
      <div className={cn('mt-3', featured && '[&_span]:!text-brass-200 [&_span_span]:!text-ink-400')}>
        <Delta now={now} before={before} inverse={inverse} />
      </div>
    </Card>
  );
}

/** Stacked bars: services below, products on top. Plain SVG keeps full control of the look. */
function RevenueChart({ data }: { data: RevenueSeries }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = data.series;
  const max = Math.max(1, ...series.map((s) => s.total));
  // Round the axis top up to a clean number of złoty.
  const step = Math.pow(10, Math.floor(Math.log10(max / 100 || 1)));
  const top = Math.ceil(max / 100 / step) * step * 100;
  const W = 1000;
  const H = 280;
  const pad = { l: 8, r: 8, t: 12, b: 28 };
  const slot = (W - pad.l - pad.r) / series.length;
  const bar = Math.max(3, Math.min(34, slot * 0.62));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const label = (p: string) => (data.groupBy === 'month' ? monthLong(p).split(' ')[0].slice(0, 3) : isoDay(p).split(' ').slice(1).join(' '));
  const every = Math.ceil(series.length / 10);
  const active = hover !== null ? series[hover] : null;

  return (
    <div className="relative">
      <div className="mb-4 flex min-h-11 flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-ink-500">{active ? (data.groupBy === 'day' ? isoDay(active.period) : data.groupBy === 'week' ? `Week of ${isoDay(active.period)}` : monthLong(active.period)) : `By ${data.groupBy}`}</p>
          {active && (
            <p className="tnum text-sm text-ink-800">
              <strong className="font-medium text-ink-950">{money(active.total)}</strong> · services {money(active.services)} · products {money(active.products)} · {active.visits} paid visit{active.visits === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <ul className="flex gap-4 text-[12px] text-ink-600">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-ink-900" /> Services
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-brass-400" /> Products
          </li>
        </ul>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Revenue by ${data.groupBy}`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} stroke="currentColor" className="text-ink-900/8" strokeDasharray={f ? '3 5' : undefined} />
            <text x={W - pad.r} y={y(top * f) - 5} textAnchor="end" className="tnum fill-ink-400 text-[11px]">
              {money(top * f)}
            </text>
          </g>
        ))}
        {series.map((s, i) => {
          const x = pad.l + slot * i + (slot - bar) / 2;
          const dim = hover !== null && hover !== i;
          return (
            <g key={s.period} onMouseEnter={() => setHover(i)} opacity={dim ? 0.35 : 1} className="transition-opacity">
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
              {s.services > 0 && <rect x={x} y={y(s.services)} width={bar} height={y(0) - y(s.services)} rx={Math.min(4, bar / 2)} className="fill-ink-900" />}
              {s.products > 0 && <rect x={x} y={y(s.total)} width={bar} height={Math.max(0, y(s.services) - y(s.total) - (s.services ? 2 : 0))} rx={Math.min(4, bar / 2)} className="fill-brass-400" />}
              {i % every === 0 && (
                <text x={x + bar / 2} y={H - 8} textAnchor="middle" className="tnum fill-ink-500 text-[11px]">
                  {label(s.period)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BarList({ rows }: { rows: { key: string; label: string; value: number; display: string; sub?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-sm text-ink-500">Nothing in this period.</p>;
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink-900">{r.label}</span>
            <span className="tnum shrink-0 text-ink-600">
              <strong className="font-medium text-ink-950">{r.display}</strong>
              {r.sub && <span className="ml-2 text-[12px] text-ink-400">{r.sub}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-900/6">
            <div className="h-full rounded-full bg-ink-900 transition-[width] duration-700 ease-out" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Analytics() {
  const [range, setRange] = useState<Range>('30');
  const to = isoDate();
  const from = addDays(to, -(Number(range) - 1));
  const query = { from, to };

  const summary = useQuery({ queryKey: ['reports', 'summary', query], queryFn: () => api<Summary>('/reports/summary', { query }) });
  const revenue = useQuery({ queryKey: ['reports', 'revenue', query], queryFn: () => api<RevenueSeries>('/reports/revenue', { query }) });
  const barbers = useQuery({ queryKey: ['reports', 'barbers', query], queryFn: () => api<BarberReport>('/reports/barbers', { query }) });
  const services = useQuery({ queryKey: ['reports', 'services', query], queryFn: () => api<{ services: { serviceId: string; name: string; bookings: number; value: number }[] }>('/reports/services', { query }) });
  const products = useQuery({ queryKey: ['reports', 'products', query], queryFn: () => api<{ products: { productId: string; name: string; units: number; value: number; stock: number }[] }>('/reports/products', { query }) });

  const c = summary.data?.current;
  const p = summary.data?.previous;

  return (
    <>
      <PageHeader
        eyebrow="Owner"
        title="Analytics"
        action={
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '365', label: '12 months' },
            ]}
          />
        }
      >
        {isoDay(from)} – {isoDay(to)}. Revenue counts what has actually been paid; each figure is compared with the {range} days before.
      </PageHeader>

      {!c || !p ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className={cn('h-36 !rounded-3xl', i === 0 && 'sm:col-span-2')} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile featured label="Revenue" value={money(c.revenue)} now={c.revenue} before={p.revenue} />
          <Tile label="Completed visits" value={String(c.completed)} now={c.completed} before={p.completed} />
          <Tile label="Average ticket" value={money(c.averageTicket)} now={c.averageTicket} before={p.averageTicket} />
          <Tile label="No-show rate" value={percent(c.noShowRate)} now={c.noShowRate} before={p.noShowRate} inverse />
          <Tile label="Cancellation rate" value={percent(c.cancelRate)} now={c.cancelRate} before={p.cancelRate} inverse />
          <Tile label="Product orders" value={String(c.orders)} now={c.orders} before={p.orders} />
          <Tile label="New clients" value={String(c.newClients)} now={c.newClients} before={p.newClients} />
        </div>
      )}

      <Card className="mt-6 p-5 sm:p-8">
        <h2 className="display mb-4 text-3xl text-ink-950">Revenue</h2>
        {revenue.data ? <RevenueChart data={revenue.data} /> : <Skeleton className="h-72" />}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="p-5 pb-3 sm:p-8 sm:pb-4">
          <h2 className="display text-3xl text-ink-950">Barbers</h2>
          <p className="mt-1.5 text-sm text-ink-500">Utilisation is booked service time as a share of the hours each barber was available.</p>
        </div>
        {!barbers.data ? (
          <Skeleton className="m-8 h-40" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-y hairline text-[12px] text-ink-500">
                  {['Barber', 'Utilisation', 'Booked / available', 'Visits', 'No-shows', 'Revenue'].map((h, i) => (
                    <th key={h} scope="col" className={cn('px-5 py-3 font-medium sm:px-8', i >= 3 && 'text-right')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-900/6">
                {barbers.data.barbers.map((b) => (
                  <tr key={b.barberId} className={cn(!b.isActive && 'opacity-55')}>
                    <td className="px-5 py-3.5 sm:px-8">
                      <span className="flex items-center gap-3 font-medium text-ink-950">
                        <Avatar person={b} src={b.photoUrl} size={32} /> {fullName(b)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 sm:px-8">
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-ink-900/6">
                          <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', b.utilisation >= 0.75 ? 'bg-ok-600' : b.utilisation >= 0.45 ? 'bg-brass-400' : 'bg-ink-400')} style={{ width: percent(b.utilisation) }} />
                        </div>
                        <span className="tnum w-10 font-medium text-ink-950">{percent(b.utilisation)}</span>
                      </div>
                    </td>
                    <td className="tnum px-5 py-3.5 text-ink-600 sm:px-8">
                      {duration(b.bookedMinutes)} / {duration(b.availableMinutes)}
                    </td>
                    <td className="tnum px-5 py-3.5 text-right text-ink-800 sm:px-8">{b.bookings}</td>
                    <td className="tnum px-5 py-3.5 text-right text-ink-800 sm:px-8">{b.noShow}</td>
                    <td className="tnum px-5 py-3.5 text-right font-medium text-ink-950 sm:px-8">{money(b.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5 sm:p-8">
          <h2 className="display mb-5 text-3xl text-ink-950">Most booked services</h2>
          {services.data ? (
            <BarList rows={services.data.services.slice(0, 7).map((s) => ({ key: s.serviceId, label: s.name, value: s.bookings, display: `${s.bookings} visits`, sub: money(s.value) }))} />
          ) : (
            <Skeleton className="h-48" />
          )}
        </Card>
        <Card className="p-5 sm:p-8">
          <h2 className="display mb-5 text-3xl text-ink-950">Best selling products</h2>
          {products.data ? (
            <BarList rows={products.data.products.slice(0, 7).map((s) => ({ key: s.productId, label: s.name, value: s.units, display: `${s.units} sold`, sub: `${money(s.value)} · ${s.stock} left` }))} />
          ) : (
            <Skeleton className="h-48" />
          )}
        </Card>
      </div>
    </>
  );
}
