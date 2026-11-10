import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Avatar, ButtonLink, Empty, PageLoader, Skeleton } from '../components/ui';
import { api, ApiError, Barber } from '../lib/api';
import { duration, fullName, money } from '../lib/format';
import { BarberCard, Portrait, useBarbers, useServices } from './Home';

function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <header className="mx-auto max-w-7xl px-5 pt-14 pb-12 sm:px-8 sm:pt-20">
      <p className="eyebrow mb-4">{eyebrow}</p>
      <h1 className="display max-w-4xl animate-rise text-6xl text-ink-950 sm:text-8xl">{title}</h1>
      <p className="mt-6 max-w-xl animate-rise text-lg leading-relaxed text-ink-500 [animation-delay:100ms]">{children}</p>
    </header>
  );
}

export function ServicesPage() {
  const services = useServices();
  const barbers = useBarbers();
  const list = services.data?.filter((s) => s.priceFrom !== null) ?? [];

  return (
    <>
      <PageIntro
        eyebrow="Services"
        title={
          <>
            The <span className="italic">menu.</span>
          </>
        }
      >
        Every service has a fixed length, so your slot is yours. Prices vary by barber — the figure here is where they start.
      </PageIntro>
      <section className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="border-t hairline">
          {services.isLoading && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="my-6 h-20" />)}
          {list.map((s, i) => {
            const who = barbers.data?.filter((b) => s.barberIds.includes(b.id)) ?? [];
            return (
              <article key={s.id} className="grid gap-x-8 gap-y-5 border-b hairline py-8 md:grid-cols-[3rem_1.4fr_1fr_auto] md:items-center">
                <span className="tnum hidden text-[13px] text-ink-400 md:block">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h2 className="display text-4xl text-ink-950">{s.name}</h2>
                  {s.description && <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-ink-500">{s.description}</p>}
                </div>
                <div className="flex items-center gap-6">
                  <div>
                    <p className="tnum text-xl font-medium text-ink-950">
                      {s.priceFrom !== s.priceTo && <span className="mr-1 text-[13px] font-normal text-ink-500">from</span>}
                      {money(s.priceFrom!)}
                    </p>
                    <p className="tnum mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-500">
                      <Clock className="size-3.5" /> {duration(s.duration)}
                    </p>
                  </div>
                  <div className="flex -space-x-2" title={who.map((b) => b.firstName).join(', ')}>
                    {who.map((b) => (
                      <Avatar key={b.id} person={b} src={b.photoUrl} size={34} className="ring-2 !ring-paper" />
                    ))}
                  </div>
                </div>
                <ButtonLink to={`/book?service=${s.id}`} variant="outline">
                  Book <ArrowRight className="size-4" />
                </ButtonLink>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

export function BarbersPage() {
  const barbers = useBarbers();
  return (
    <>
      <PageIntro
        eyebrow="Barbers"
        title={
          <>
            The people <span className="italic">behind the chairs.</span>
          </>
        }
      >
        Different hands, different strengths. Read up, pick the one who fits, and book them directly.
      </PageIntro>
      <section className="mx-auto grid max-w-7xl gap-x-6 gap-y-14 px-5 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        {barbers.isLoading
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[4/5] !rounded-[28px]" />)
          : barbers.data?.map((b, i) => (
              <div key={b.id} className="animate-rise" style={{ animationDelay: `${i * 80}ms` }}>
                <BarberCard barber={b} />
              </div>
            ))}
      </section>
    </>
  );
}

export function BarberPage() {
  const { id } = useParams();
  const barber = useQuery({
    queryKey: ['barbers', id],
    queryFn: () => api<Barber>(`/barbers/${id}`),
    retry: (count, e) => !(e instanceof ApiError && e.status === 404) && count < 2,
  });

  if (barber.isLoading) return <PageLoader />;
  if (!barber.data) {
    return (
      <Empty title="This barber is not with us" action={<ButtonLink to="/barbers">Meet the team</ButtonLink>} className="py-32">
        The profile you are looking for is not available.
      </Empty>
    );
  }
  const b = barber.data;

  return (
    <div className="mx-auto max-w-7xl px-5 pt-10 sm:px-8 sm:pt-14">
      <Link to="/barbers" className="mb-8 inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-950">
        <ArrowLeft className="size-4" /> All barbers
      </Link>
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <div className="aspect-[4/5] animate-rise overflow-hidden rounded-[32px] bg-ink-100 shadow-soft">
            <Portrait barber={b} />
          </div>
        </div>
        <div>
          {b.title && <p className="eyebrow mb-4 animate-rise text-brass-600">{b.title}</p>}
          <h1 className="display animate-rise text-6xl text-ink-950 [animation-delay:60ms] sm:text-8xl">{fullName(b)}</h1>
          {b.bio && <p className="mt-7 max-w-xl animate-rise text-lg leading-relaxed text-ink-600 [animation-delay:120ms]">{b.bio}</p>}
          <ButtonLink to={`/book?barber=${b.id}`} size="lg" className="mt-9 animate-rise [animation-delay:180ms]">
            Book with {b.firstName} <ArrowRight className="size-4" />
          </ButtonLink>

          <h2 className="eyebrow mt-16 mb-2">Services and prices</h2>
          <div className="border-t hairline">
            {b.services.length === 0 && <p className="py-8 text-sm text-ink-500">No services listed yet.</p>}
            {b.services.map((s) => (
              <Link
                key={s.serviceId}
                to={`/book?barber=${b.id}&service=${s.serviceId}`}
                className="group flex items-center gap-6 border-b hairline py-5 transition-colors hover:border-ink-900/40"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="display text-[28px] text-ink-950 transition-transform duration-300 group-hover:translate-x-1.5">{s.name}</h3>
                  <p className="tnum mt-1 text-[13px] text-ink-500">{duration(s.duration)}</p>
                </div>
                <p className="tnum text-lg font-medium text-ink-950">{money(s.price)}</p>
                <span className="flex size-10 items-center justify-center rounded-full border border-ink-900/12 text-ink-700 transition-all duration-300 group-hover:border-ink-900 group-hover:bg-ink-900 group-hover:text-paper">
                  <ArrowRight className="size-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
