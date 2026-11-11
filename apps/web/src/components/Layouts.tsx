import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  ExternalLink,
  History,
  LayoutGrid,
  LogOut,
  Menu,
  Package,
  Scissors,
  ShoppingBag,
  Store,
  UserRound,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api, Cart } from '../lib/api';
import { homeFor, useAuth } from '../lib/auth';
import { fullName } from '../lib/format';
import { SHOP } from '../lib/shop';
import { cartUi } from './CartDrawer';
import { Avatar, ButtonLink, cn, IconButton } from './ui';

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <Link to="/" className={cn('group inline-flex items-center gap-2.5', className)} aria-label="Chairtime — home">
      <span className="pole h-7 w-2.5 rounded-full ring-1 ring-black/15 transition-[background-position] duration-700 group-hover:[background-position:0_28px]" />
      <span className={cn('display text-[26px] leading-none', light ? 'text-paper' : 'text-ink-950')}>Chairtime</span>
    </Link>
  );
}

export { SHOP };

const NAV = [
  { to: '/services', label: 'Services' },
  { to: '/barbers', label: 'Barbers' },
  { to: '/shop', label: 'Shop' },
];

function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [threshold]);
  return scrolled;
}

export function PublicLayout() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const scrolled = useScrolled();
  const [menu, setMenu] = useState(false);
  const [account, setAccount] = useState(false);
  // On the home page the header floats over the dark hero until the page is scrolled.
  const overHero = pathname === '/' && !scrolled && !menu;

  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api<Cart>('/cart'), enabled: !!user });
  const count = cart.data?.itemCount ?? 0;

  useEffect(() => {
    setMenu(false);
    setAccount(false);
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-40 transition-[background,border-color,box-shadow] duration-300',
          overHero ? 'border-b border-transparent' : 'border-b hairline bg-paper/85 backdrop-blur-xl',
        )}
      >
        <div className="mx-auto flex h-18 max-w-7xl items-center gap-6 px-5 sm:px-8">
          <Logo light={overHero} />
          <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-full px-4 py-2 text-sm font-medium transition-colors',
                    overHero
                      ? 'text-paper/75 hover:text-paper'
                      : isActive
                        ? 'bg-ink-900/6 text-ink-950'
                        : 'text-ink-600 hover:text-ink-950',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => (user ? cartUi.open() : navigate('/login', { state: { from: pathname } }))}
              aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
              className={cn(
                'relative inline-flex size-10 items-center justify-center rounded-full transition-colors',
                overHero ? 'text-paper hover:bg-white/10' : 'text-ink-700 hover:bg-ink-900/7',
              )}
            >
              <ShoppingBag className="size-[19px]" />
              {count > 0 && (
                <span className="tnum absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brass-400 px-1 text-[11px] font-semibold text-ink-950">
                  {count}
                </span>
              )}
            </button>

            {user ? (
              <div className="relative hidden md:block">
                <button
                  type="button"
                  onClick={() => setAccount((v) => !v)}
                  aria-expanded={account}
                  aria-haspopup="menu"
                  className={cn(
                    'flex items-center gap-2.5 rounded-full py-1 pr-3.5 pl-1 text-sm font-medium transition-colors',
                    overHero ? 'text-paper hover:bg-white/10' : 'text-ink-800 hover:bg-ink-900/7',
                  )}
                >
                  <Avatar person={user} size={32} />
                  {user.firstName}
                </button>
                {account && (
                  <>
                    <button type="button" className="fixed inset-0 cursor-default" aria-hidden tabIndex={-1} onClick={() => setAccount(false)} />
                    <div role="menu" className="absolute right-0 mt-2 w-60 animate-fade rounded-2xl border hairline bg-card p-1.5 shadow-lift">
                      <div className="px-3 py-2.5">
                        <p className="truncate text-sm font-medium text-ink-950">{fullName(user)}</p>
                        <p className="truncate text-[13px] text-ink-500">{user.phoneNumber}</p>
                      </div>
                      <div className="my-1 border-t hairline" />
                      <MenuLink to={homeFor(user)} icon={user.role === 'CLIENT' ? <CalendarDays /> : <LayoutGrid />}>
                        {user.role === 'CLIENT' ? 'My bookings' : 'Dashboard'}
                      </MenuLink>
                      {user.role === 'CLIENT' && (
                        <MenuLink to="/account/profile" icon={<UserRound />}>
                          Profile
                        </MenuLink>
                      )}
                      <MenuLink to="/account/orders" icon={<Package />}>
                        My orders
                      </MenuLink>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => signOut().then(() => navigate('/'))}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-900/5 [&>svg]:size-4"
                      >
                        <LogOut /> Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                className={cn(
                  'hidden rounded-full px-4 py-2 text-sm font-medium transition-colors md:block',
                  overHero ? 'text-paper/80 hover:text-paper' : 'text-ink-700 hover:text-ink-950',
                )}
              >
                Sign in
              </Link>
            )}

            <ButtonLink to="/book" variant={overHero ? 'brass' : 'primary'} size="sm" className="ml-1.5 hidden h-10 px-5 sm:inline-flex">
              Book now
            </ButtonLink>
            <IconButton
              label="Menu"
              onClick={() => setMenu((v) => !v)}
              className={cn('md:hidden', overHero && 'text-paper hover:bg-white/10 hover:text-paper')}
            >
              {menu ? <X className="size-5" /> : <Menu className="size-5" />}
            </IconButton>
          </div>
        </div>

        {menu && (
          <div className="animate-fade border-t hairline bg-paper px-5 pt-3 pb-6 md:hidden">
            <nav className="flex flex-col" aria-label="Mobile">
              {NAV.map((n) => (
                <Link key={n.to} to={n.to} className="display border-b hairline py-4 text-3xl text-ink-950">
                  {n.label}
                </Link>
              ))}
              {user ? (
                <>
                  <Link to={homeFor(user)} className="display border-b hairline py-4 text-3xl text-ink-950">
                    {user.role === 'CLIENT' ? 'My bookings' : 'Dashboard'}
                  </Link>
                  <button type="button" onClick={() => signOut().then(() => navigate('/'))} className="py-4 text-left text-sm font-medium text-ink-600">
                    Sign out
                  </button>
                </>
              ) : (
                <Link to="/login" className="display border-b hairline py-4 text-3xl text-ink-950">
                  Sign in
                </Link>
              )}
            </nav>
            <ButtonLink to="/book" size="lg" className="mt-5 w-full">
              Book now
            </ButtonLink>
          </div>
        )}
      </header>

      <main className={cn('flex-1', pathname !== '/' && 'pt-18')}>
        <Outlet />
      </main>

      <footer className="relative mt-24 overflow-hidden bg-ink-950 text-ink-300">
        <div className="pole h-1.5 w-full opacity-90 [background-size:100%_28px]" />
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:grid-cols-2 lg:grid-cols-[1.3fr_0.9fr_1.2fr_0.8fr]">
          <div>
            <Logo light />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-ink-400">
              A neighbourhood barbershop in the heart of Warsaw. Good cuts, straight talk, and a chair that is ready when you
              are.
            </p>
          </div>
          <div>
            <p className="eyebrow mb-4 text-ink-500">Visit</p>
            <p className="text-sm leading-7">
              {SHOP.address}
              <br />
              {SHOP.city}
              <br />
              <a href={`tel:${SHOP.phone.replace(/\s/g, '')}`} className="text-paper hover:text-brass-300">
                {SHOP.phone}
              </a>
            </p>
          </div>
          <div>
            <p className="eyebrow mb-4 text-ink-500">Hours</p>
            <dl className="space-y-1.5 text-sm">
              {SHOP.hours.map(([d, h]) => (
                <div key={d} className="flex justify-between gap-4 whitespace-nowrap">
                  <dt>{d}</dt>
                  <dd className="tnum text-paper">{h}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <p className="eyebrow mb-4 text-ink-500">Explore</p>
            <ul className="space-y-2 text-sm">
              {[...NAV, { to: '/book', label: 'Book a visit' }, { to: '/login', label: 'Staff sign in' }].map((n) => (
                <li key={n.to}>
                  <Link to={n.to} className="hover:text-paper">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/8">
          <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-5 py-6 text-[13px] text-ink-500 sm:px-8">
            <p>© {new Date().getFullYear()} Chairtime Barbershop</p>
            <p>Prices in PLN, VAT included. Orders are collected at the shop.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function MenuLink({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      role="menuitem"
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-700 hover:bg-ink-900/5 hover:text-ink-950 [&>svg]:size-4"
    >
      {icon}
      {children}
    </Link>
  );
}

// ---- Staff area -------------------------------------------------------------------------------

interface StaffNavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

function staffNav(role: string): { title: string; items: StaffNavItem[] }[] {
  if (role === 'BARBER') {
    return [
      {
        title: 'My work',
        items: [
          { to: '/staff/day', label: 'My day', icon: <CalendarDays /> },
          { to: '/staff/schedule', label: 'Working hours', icon: <CalendarClock /> },
          { to: '/staff/profile', label: 'Public profile', icon: <UserRound /> },
        ],
      },
    ];
  }
  return [
    {
      title: 'Front desk',
      items: [
        { to: '/staff/today', label: 'Calendar', icon: <CalendarDays /> },
        { to: '/staff/bookings', label: 'Bookings', icon: <ClipboardList /> },
        { to: '/staff/orders', label: 'Orders', icon: <Package /> },
        { to: '/staff/clients', label: 'Clients', icon: <Users /> },
      ],
    },
    {
      title: 'Shop setup',
      items: [
        { to: '/staff/services', label: 'Services', icon: <Scissors /> },
        { to: '/staff/team', label: 'Team', icon: <UsersRound /> },
        { to: '/staff/products', label: 'Products', icon: <Store /> },
      ],
    },
    ...(role === 'OWNER'
      ? [
          {
            title: 'Owner',
            items: [
              { to: '/staff/analytics', label: 'Analytics', icon: <BarChart3 /> },
              { to: '/staff/activity', label: 'Activity', icon: <History /> },
            ],
          },
        ]
      : []),
  ];
}

const ROLE_LABEL: Record<string, string> = { BARBER: 'Barber', ADMIN: 'Administrator', OWNER: 'Owner' };

export function StaffLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  if (!user) return null;

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-950 text-ink-300">
      <div className="flex h-18 items-center px-6">
        <Logo light />
      </div>
      <nav className="flex-1 space-y-7 overflow-y-auto px-3 py-4" aria-label="Staff">
        {staffNav(user.role).map((group) => (
          <div key={group.title}>
            <p className="eyebrow mb-2 px-3 text-ink-600">{group.title}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors [&>svg]:size-[18px]',
                        isActive ? 'bg-white/10 text-paper [&>svg]:text-brass-300' : 'text-ink-400 hover:bg-white/5 hover:text-paper',
                      )
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t border-white/8 p-3">
        <Link to="/" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-400 hover:bg-white/5 hover:text-paper">
          <ExternalLink className="size-[18px]" /> View the site
        </Link>
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          <Avatar person={user} size={36} className="!bg-brass-400 !text-ink-950" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-paper">{fullName(user)}</p>
            <p className="text-[12px] text-ink-500">{ROLE_LABEL[user.role]}</p>
          </div>
          <button
            type="button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => signOut().then(() => navigate('/'))}
            className="flex size-9 items-center justify-center rounded-full text-ink-400 hover:bg-white/8 hover:text-paper"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b hairline bg-paper/90 px-4 backdrop-blur-xl lg:hidden">
        <Logo />
        <IconButton label="Menu" onClick={() => setOpen(true)}>
          <Menu className="size-5" />
        </IconButton>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 animate-fade bg-ink-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-fade shadow-lift">{sidebar}</div>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-8 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
