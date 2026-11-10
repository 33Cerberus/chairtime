import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, Clock, MapPin } from 'lucide-react';
import { Link } from 'react-router';
import { SHOP } from '../components/Layouts';
import { ButtonLink, cn, Skeleton } from '../components/ui';
import { api, Barber, ProductPage, Service } from '../lib/api';
import { duration, fullName, money } from '../lib/format';

export const useServices = () => useQuery({ queryKey: ['services'], queryFn: () => api<Service[]>('/services') });
export const useBarbers = () => useQuery({ queryKey: ['barbers'], queryFn: () => api<Barber[]>('/barbers') });

export function Portrait({ barber, className }: { barber: Pick<Barber, 'photoUrl' | 'firstName' | 'lastName'>; className?: string }) {
  return barber.photoUrl ? (
    <img src={barber.photoUrl} alt={`Portrait of ${fullName(barber)}`} className={cn('size-full object-cover', className)} loading="lazy" />
  ) : (
    <div className={cn('flex size-full items-center justify-center bg-gradient-to-br from-ink-700 to-ink-950', className)}>
      <span className="display text-7xl text-brass-300 italic">
        {barber.firstName[0]}
        {barber.lastName?.[0]}
      </span>
    </div>
  );
}

export function ServiceRow({ service, to, index }: { service: Service; to: string; index?: number }) {
  return (
    <Link
      to={to}
      className="group grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 border-b hairline py-6 transition-colors hover:border-ink-900/40 sm:grid-cols-[3rem_1fr_auto_auto]"
    >
      {index !== undefined && <span className="tnum hidden text-[13px] text-ink-400 sm:block">{String(index + 1).padStart(2, '0')}</span>}
      <div className="min-w-0">
        <h3 className="display text-[28px] text-ink-950 transition-transform duration-300 group-hover:translate-x-1.5 sm:text-[34px]">
          {service.name}
        </h3>
        {service.description && <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-500">{service.description}</p>}
      </div>
      <div className="row-span-2 text-right sm:row-span-1 sm:w-40">
        {service.priceFrom !== null ? (
          <p className="tnum text-lg font-medium text-ink-950">
            <span className="mr-1 text-[13px] font-normal text-ink-500">{service.priceFrom !== service.priceTo ? 'from' : ''}</span>
            {money(service.priceFrom)}
          </p>
        ) : (
          <p className="text-sm text-ink-400">Coming soon</p>
        )}
        <p className="tnum mt-0.5 text-[13px] text-ink-500">{duration(service.duration)}</p>
      </div>
      <span className="hidden size-11 items-center justify-center rounded-full border border-ink-900/12 text-ink-700 transition-all duration-300 group-hover:border-ink-900 group-hover:bg-ink-900 group-hover:text-paper sm:flex">
        <ArrowUpRight className="size-[18px]" />
      </span>
    </Link>
  );
}

export function BarberCard({ barber, className }: { barber: Barber; className?: string }) {
  const from = barber.services.length ? Math.min(...barber.services.map((s) => s.price)) : null;
  return (
    <Link to={`/barbers/${barber.id}`} className={cn('group block', className)}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] bg-ink-100">
        <Portrait barber={barber} className="transition-transform duration-[900ms] ease-out group-hover:scale-[1.045]" />
        <div className="absolute inset-x-0 bottom-0 flex translate-y-2 items-center justify-between bg-gradient-to-t from-ink-950/75 to-transparent p-5 pt-16 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <span className="text-sm font-medium text-paper">View profile</span>
          <ArrowUpRight className="size-5 text-paper" />
        </div>
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="display text-[28px] text-ink-950">{fullName(barber)}</h3>
          {barber.title && <p className="mt-1 text-sm text-ink-500">{barber.title}</p>}
        </div>
        {from !== null && <p className="tnum mt-2 shrink-0 text-[13px] text-ink-500">from {money(from)}</p>}
      </div>
    </Link>
  );
}

export function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div>
        <p className="eyebrow mb-3">{eyebrow}</p>
        <h2 className="display max-w-2xl text-5xl text-ink-950 sm:text-6xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

const STEPS = [
  ['Pick a service', 'From a quick tidy-up to the full cut-and-beard reset. Every service shows how long it takes.'],
  ['Choose your barber', 'Each barber sets their own price. See who does what, and book the hands you trust.'],
  ['Take a time that suits', 'Live availability, to the quarter hour. Move or cancel up to two hours before.'],
];

export default function Home() {
  const services = useServices();
  const barbers = useBarbers();
  const products = useQuery({ queryKey: ['products', 'home'], queryFn: () => api<ProductPage>('/products', { query: { limit: 4 } }) });
  const bookable = services.data?.filter((s) => s.priceFrom !== null) ?? [];
  const stack = barbers.data?.slice(0, 3) ?? [];

  return (
    <>
      {/* Hero */}
      <section className="grain relative isolate overflow-hidden bg-ink-950 text-paper">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(60% 55% at 78% 30%, rgb(193 151 73 / 0.22), transparent 70%), radial-gradient(45% 45% at 8% 90%, rgb(193 151 73 / 0.10), transparent 70%)',
          }}
        />
        <div className="mx-auto grid min-h-[min(100dvh,920px)] max-w-7xl items-center gap-14 px-5 pt-32 pb-20 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:pt-36">
          <div>
            <p className="eyebrow mb-7 flex animate-rise items-center gap-3 text-brass-300">
              <span className="h-px w-10 bg-brass-400/60" /> Barbershop · Warsaw
            </p>
            <h1 className="display animate-rise text-[clamp(3.6rem,9.5vw,7.75rem)] [animation-delay:80ms]">
              Good hair,
              <br />
              <span className="text-brass-300 italic">on your time.</span>
            </h1>
            <p className="mt-8 max-w-md animate-rise text-lg leading-relaxed text-ink-300 [animation-delay:160ms]">
              Pick a barber, pick a time, and you are done in under a minute. No phone calls, no waiting on the bench.
            </p>
            <div className="mt-10 flex animate-rise flex-wrap items-center gap-3 [animation-delay:240ms]">
              <ButtonLink to="/book" variant="brass" size="lg">
                Book a visit <ArrowRight className="size-4" />
              </ButtonLink>
              <ButtonLink to="/services" variant="ghost" size="lg" className="!text-paper hover:!bg-white/10">
                See services
              </ButtonLink>
            </div>
            <dl className="mt-14 flex animate-rise flex-wrap gap-x-10 gap-y-4 text-sm text-ink-300 [animation-delay:320ms]">
              <div className="flex items-center gap-2.5">
                <Clock className="size-4 text-brass-300" />
                <span>
                  Mon–Fri <span className="tnum text-paper">9–20</span> · Sat <span className="tnum text-paper">10–16</span>
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <MapPin className="size-4 text-brass-300" />
                <span>
                  {SHOP.address}, <span className="text-paper">Śródmieście</span>
                </span>
              </div>
            </dl>
          </div>

          {/* Barber portraits, fanned like cards on a counter */}
          <div className="relative mx-auto hidden h-[540px] w-full max-w-md lg:block" aria-hidden={!stack.length}>
            {stack.length === 0 && <div className="absolute inset-6 rounded-[32px] bg-white/5" />}
            {stack.map((b, i) => {
              const pose = [
                'left-0 top-10 -rotate-[7deg] z-10',
                'right-0 top-0 rotate-[5deg] z-20',
                'left-1/2 -translate-x-1/2 top-40 rotate-[-1.5deg] z-30',
              ][i];
              return (
                <Link
                  key={b.id}
                  to={`/barbers/${b.id}`}
                  className={cn(
                    'group absolute w-[58%] animate-rise overflow-hidden rounded-[28px] bg-ink-800 shadow-lift ring-1 ring-white/10 transition-transform duration-500 hover:z-40 hover:scale-[1.04] hover:rotate-0',
                    pose,
                  )}
                  style={{ animationDelay: `${300 + i * 120}ms` }}
                >
                  <div className="aspect-[4/5]">
                    <Portrait barber={b} />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/85 to-transparent p-4 pt-12">
                    <p className="display text-2xl text-paper">{b.firstName}</p>
                    <p className="truncate text-[12px] text-ink-300">{b.title?.split('·')[1]?.trim() ?? 'Barber'}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Service ticker */}
        <div className="relative border-t border-white/8 py-5">
          <div className="flex w-max animate-[marquee_38s_linear_infinite] gap-10 whitespace-nowrap pr-10 hover:[animation-play-state:paused]">
            {[0, 1].map((n) => (
              <div key={n} className="flex gap-10" aria-hidden={n === 1}>
                {(bookable.length ? bookable.map((s) => s.name) : ['Classic Haircut', 'Skin Fade', 'Beard Trim', 'Hot Towel Shave']).map((name) => (
                  <span key={name} className="display flex items-center gap-10 text-2xl text-ink-400 italic">
                    {name} <span className="size-1.5 rounded-full bg-brass-400" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
        <style>{`@keyframes marquee { to { transform: translateX(-50%); } }`}</style>
      </section>

      {/* Services */}
      <section className="mx-auto max-w-7xl px-5 pt-24 sm:px-8 sm:pt-32">
        <SectionHeading
          eyebrow="The menu"
          title={
            <>
              Cuts, shaves, <span className="italic">and everything between.</span>
            </>
          }
          action={
            <ButtonLink to="/services" variant="outline">
              All services <ArrowRight className="size-4" />
            </ButtonLink>
          }
        />
        <div className="border-t hairline">
          {services.isLoading
            ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="my-6 h-16" />)
            : bookable.slice(0, 6).map((s, i) => <ServiceRow key={s.id} service={s} index={i} to={`/book?service=${s.id}`} />)}
        </div>
      </section>

      {/* Barbers */}
      <section className="mx-auto max-w-7xl px-5 pt-24 sm:px-8 sm:pt-32">
        <SectionHeading
          eyebrow="The chairs"
          title={
            <>
              Pick your barber. <span className="italic">Each has a signature.</span>
            </>
          }
          action={
            <ButtonLink to="/barbers" variant="outline">
              Meet the team <ArrowRight className="size-4" />
            </ButtonLink>
          }
        />
        <div className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {barbers.isLoading
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[4/5] !rounded-[28px]" />)
            : barbers.data?.map((b) => <BarberCard key={b.id} barber={b} />)}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-5 pt-24 sm:px-8 sm:pt-32">
        <div className="grid gap-px overflow-hidden rounded-[32px] border hairline bg-ink-900/8 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <div key={title} className="bg-card p-8 sm:p-10">
              <p className="display text-6xl text-brass-400 italic">{i + 1}</p>
              <h3 className="display mt-6 text-3xl text-ink-950">{title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Shop teaser */}
      <section className="mx-auto max-w-7xl px-5 pt-24 sm:px-8 sm:pt-32">
        <SectionHeading
          eyebrow="Take it home"
          title={
            <>
              What we use <span className="italic">is what we sell.</span>
            </>
          }
          action={
            <ButtonLink to="/shop" variant="outline">
              Visit the shop <ArrowRight className="size-4" />
            </ButtonLink>
          }
        />
        <div className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
          {products.isLoading
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[5/6] !rounded-[28px]" />)
            : products.data?.items.map((p) => (
                <Link key={p.id} to={`/shop/${p.id}`} className="group">
                  <div className="aspect-[5/6] overflow-hidden rounded-[28px] bg-ink-100">
                    {p.photoUrls[0] && (
                      <img src={p.photoUrls[0]} alt={p.name} loading="lazy" className="size-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.05]" />
                    )}
                  </div>
                  <div className="mt-4 flex items-baseline justify-between gap-3">
                    <h3 className="text-[15px] font-medium text-ink-950">{p.name}</h3>
                    <p className="tnum shrink-0 text-[15px] text-ink-600">{money(p.price)}</p>
                  </div>
                </Link>
              ))}
        </div>
      </section>

      {/* Closing call */}
      <section className="mx-auto max-w-7xl px-5 pt-24 sm:px-8 sm:pt-32">
        <div className="grain relative isolate overflow-hidden rounded-[36px] bg-ink-900 px-8 py-20 text-center text-paper sm:py-28">
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{ background: 'radial-gradient(50% 80% at 50% 0%, rgb(193 151 73 / 0.25), transparent 70%)' }}
          />
          <h2 className="display mx-auto max-w-3xl text-6xl sm:text-8xl">
            Your chair <span className="text-brass-300 italic">is waiting.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-md text-ink-300">Bookings open thirty days ahead. The good slots go first.</p>
          <ButtonLink to="/book" variant="brass" size="lg" className="mt-10">
            Book a visit <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
