import { lazy, ReactNode, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { CartDrawer } from './components/CartDrawer';
import { PublicLayout, StaffLayout } from './components/Layouts';
import { ButtonLink, Empty, PageLoader, Toaster } from './components/ui';
import { Role } from './lib/api';
import { homeFor, useAuth } from './lib/auth';
import Home from './pages/Home';

// Only the home page ships in the first download; every other screen loads when it is opened.
const named = <M, K extends keyof M>(load: () => Promise<M>, key: K) =>
  lazy(() => load().then((m) => ({ default: m[key] as React.ComponentType })));

const Book = lazy(() => import('./pages/Book'));
const ServicesPage = named(() => import('./pages/Catalog'), 'ServicesPage');
const BarbersPage = named(() => import('./pages/Catalog'), 'BarbersPage');
const BarberPage = named(() => import('./pages/Catalog'), 'BarberPage');
const ShopPage = named(() => import('./pages/Shop'), 'ShopPage');
const ProductPage_ = named(() => import('./pages/Shop'), 'ProductPage_');
const AccountLayout = named(() => import('./pages/Account'), 'AccountLayout');
const AccountBookings = named(() => import('./pages/Account'), 'AccountBookings');
const AccountOrders = named(() => import('./pages/Account'), 'AccountOrders');
const AccountProfile = named(() => import('./pages/Account'), 'AccountProfile');
const LoginPage = named(() => import('./pages/Auth'), 'LoginPage');
const RegisterPage = named(() => import('./pages/Auth'), 'RegisterPage');
const ResetPasswordPage = named(() => import('./pages/Auth'), 'ResetPasswordPage');
const SetPasswordPage = named(() => import('./pages/Auth'), 'SetPasswordPage');

// The staff area is a separate chunk: clients never download it.
const DayBoard = lazy(() => import('./pages/staff/DayBoard'));
const StaffBookings = lazy(() => import('./pages/staff/Bookings'));
const StaffOrders = lazy(() => import('./pages/staff/Orders'));
const StaffClients = lazy(() => import('./pages/staff/Clients'));
const StaffServices = lazy(() => import('./pages/staff/Services'));
const StaffTeam = lazy(() => import('./pages/staff/Team'));
const StaffProducts = lazy(() => import('./pages/staff/Products'));
const Analytics = lazy(() => import('./pages/staff/Analytics'));
const Activity = lazy(() => import('./pages/staff/Activity'));
const MySchedule = lazy(() => import('./pages/staff/Team').then((m) => ({ default: m.MySchedule })));
const MyProfile = lazy(() => import('./pages/staff/Team').then((m) => ({ default: m.MyProfile })));

/** Signed-out visitors go to sign-in and come back; the wrong role goes to its own home. */
function Guard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <PageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

const ADMINS: Role[] = ['ADMIN', 'OWNER'];

function AccountIndex() {
  const { user } = useAuth();
  return user?.role === 'CLIENT' ? <AccountBookings /> : <Navigate to="/account/orders" replace />;
}

export default function App() {
  return (
    <>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Home />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="barbers" element={<BarbersPage />} />
            <Route path="barbers/:id" element={<BarberPage />} />
            <Route path="book" element={<Book />} />
            <Route path="shop" element={<ShopPage />} />
            <Route path="shop/:id" element={<ProductPage_ />} />
            <Route
              path="account"
              element={
                <Guard>
                  <AccountLayout />
                </Guard>
              }
            >
              <Route index element={<AccountIndex />} />
              <Route path="orders" element={<AccountOrders />} />
              <Route path="profile" element={<AccountProfile />} />
            </Route>
            <Route
              path="*"
              element={
                <Empty title="Nothing at this address" action={<ButtonLink to="/">Back to the start</ButtonLink>} className="py-32">
                  The page may have moved, or the link is mistyped.
                </Empty>
              }
            />
          </Route>

          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="set-password" element={<SetPasswordPage />} />

          <Route
            path="staff"
            element={
              <Guard roles={['BARBER', 'ADMIN', 'OWNER']}>
                <StaffLayout />
              </Guard>
            }
          >
            <Route index element={<StaffIndex />} />
            <Route path="day" element={<Guard roles={['BARBER']}><DayBoard /></Guard>} />
            <Route path="schedule" element={<Guard roles={['BARBER']}><MySchedule /></Guard>} />
            <Route path="profile" element={<Guard roles={['BARBER']}><MyProfile /></Guard>} />
            <Route path="today" element={<Guard roles={ADMINS}><DayBoard /></Guard>} />
            <Route path="bookings" element={<Guard roles={ADMINS}><StaffBookings /></Guard>} />
            <Route path="orders" element={<Guard roles={ADMINS}><StaffOrders /></Guard>} />
            <Route path="clients" element={<Guard roles={ADMINS}><StaffClients /></Guard>} />
            <Route path="services" element={<Guard roles={ADMINS}><StaffServices /></Guard>} />
            <Route path="team" element={<Guard roles={ADMINS}><StaffTeam /></Guard>} />
            <Route path="products" element={<Guard roles={ADMINS}><StaffProducts /></Guard>} />
            <Route path="analytics" element={<Guard roles={['OWNER']}><Analytics /></Guard>} />
            <Route path="activity" element={<Guard roles={['OWNER']}><Activity /></Guard>} />
          </Route>
        </Routes>
      </Suspense>
      <CartDrawer />
      <Toaster />
    </>
  );
}

function StaffIndex() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}
