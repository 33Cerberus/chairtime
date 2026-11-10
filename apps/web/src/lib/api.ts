/** Typed client for the Chairtime API (docs/api.md). */

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

// The access token lives in memory only. The refresh token is an httpOnly cookie the
// browser sends to /auth/* by itself, so nothing sensitive is ever readable from script.
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

// A non-secret marker that this browser has signed in before. Without it a first-time
// visitor would fire a refresh request that can only fail.
const HINT = 'ct_session';
const hasHint = () => {
  try {
    return localStorage.getItem(HINT) === '1';
  } catch {
    return true;
  }
};
const setHint = (on: boolean) => {
  try {
    if (on) localStorage.setItem(HINT, '1');
    else localStorage.removeItem(HINT);
  } catch {
    /* storage unavailable: the refresh is simply always attempted */
  }
};

export const setAccessToken = (t: string | null) => {
  accessToken = t;
  setHint(!!t);
};
export const setSessionLostHandler = (fn: () => void) => {
  onSessionLost = fn;
};

let refreshing: Promise<Session | null> | null = null;

/** Single-flight: any number of callers share one refresh request. */
export function refreshSession(): Promise<Session | null> {
  if (!refreshing && !hasHint()) return Promise.resolve(null);
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) {
        if (res.status === 401) setHint(false);
        return null;
      }
      const session = (await res.json()) as Session;
      setAccessToken(session.accessToken);
      return session;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

interface Options {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  form?: FormData;
}

async function send(path: string, o: Options) {
  const qs = o.query
    ? Object.entries(o.query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return fetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, {
    method: o.method ?? 'GET',
    credentials: 'include',
    headers: {
      ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
  });
}

export async function api<T>(path: string, o: Options = {}): Promise<T> {
  let res = await send(path, o);
  // An expired access token is renewed once, transparently.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const hadToken = !!accessToken;
    const session = await refreshSession();
    if (session) res = await send(path, o);
    else if (hadToken) {
      accessToken = null;
      onSessionLost?.();
    }
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? 'Something went wrong', data?.code, data?.details);
  }
  return data as T;
}

export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong';

// ---- Types ----------------------------------------------------------------------------------

export type Role = 'CLIENT' | 'BARBER' | 'ADMIN' | 'OWNER';
export type BookingStatus = 'BOOKED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED' | 'NO_SHOW';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDING' | 'REFUNDED';
export type OrderStatus = 'CREATED' | 'IN_PROGRESS' | 'READY' | 'RECEIVED' | 'CANCELED';
export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export interface User {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneNumber: string;
  email: string | null;
  role: Role;
  isActive: boolean;
  hasPassword: boolean;
  barberId: string | null;
  createdAt: string;
}

export interface Session {
  accessToken: string;
  user: User;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  duration: number;
  isActive: boolean;
  priceFrom: number | null;
  priceTo: number | null;
  barberIds: string[];
}

export interface BarberOffer {
  serviceId: string;
  name: string;
  description: string | null;
  duration: number;
  isActive: boolean;
  price: number;
}

export interface Barber {
  id: string;
  firstName: string;
  lastName: string | null;
  title: string | null;
  bio: string | null;
  photoUrl: string | null;
  isActive: boolean;
  services: BarberOffer[];
}

export interface Slot {
  startAt: string;
  endAt: string;
  time: string;
}

export interface SlotsResponse {
  date: string;
  duration: number;
  price: number;
  slots: Slot[];
}

export interface SlotCalendar {
  days: { date: string; slotCount: number; firstTime: string | null }[];
}

export interface Booking {
  id: string;
  startAt: string;
  serviceEndAt: string;
  endAt: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  priceSnapshot: number;
  durationSnapshot: number;
  note: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  service: { id: string; name: string };
  barber: { id: string; firstName: string; lastName: string | null; photoUrl: string | null };
  client: { id: string; firstName: string; lastName: string | null; phoneNumber: string };
  actions: {
    move: boolean;
    cancel: boolean;
    pay: boolean;
    start: boolean;
    complete: boolean;
    noShow: boolean;
    markPaid: boolean;
    refund: boolean;
  };
  refund?: 'none' | 'manual' | 'refunding' | 'refunded';
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  photoUrls: string[];
  isActive: boolean;
  category: string | null;
}

export interface ProductPage extends Page<Product> {
  categories: string[];
}

export interface CartLine {
  productId: string;
  quantity: number;
  name: string;
  price: number;
  photoUrl: string | null;
  stock: number;
  available: boolean;
  lineTotal: number;
}

export interface Cart {
  items: CartLine[];
  itemCount: number;
  total: number;
  canCheckout: boolean;
}

export interface Order {
  id: string;
  pickupCode: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalPrice: number;
  createdAt: string;
  canceledAt: string | null;
  client: { id: string; firstName: string; lastName: string | null; phoneNumber: string };
  items: { productId: string; name: string; photoUrl: string | null; quantity: number; priceSnapshot: number; lineTotal: number }[];
  actions: { cancel: boolean; pay: boolean; advanceTo: OrderStatus | null; markPaid: boolean; refund: boolean };
  refund?: 'none' | 'manual' | 'refunding' | 'refunded';
}

export interface PaymentStart {
  paymentId: string;
  amount: number;
  provider: 'stripe' | 'mock';
  publishableKey: string | null;
  clientSecret: string | null;
  currency: string;
}

export interface TimeRange {
  startTime: string;
  endTime: string;
}

export interface WorkingHours {
  barberId: string;
  timezone: string;
  days: Record<DayOfWeek, TimeRange[]>;
}

export interface ScheduleException {
  id: string;
  date: string;
  type: 'BLOCKING' | 'ADDITIONAL';
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

export interface ResolvedSchedule {
  days: { date: string; hours: TimeRange[]; exceptions: ScheduleException[] }[];
}

export interface Totals {
  revenue: number;
  serviceRevenue: number;
  productRevenue: number;
  bookings: number;
  completed: number;
  upcoming: number;
  canceled: number;
  noShow: number;
  noShowRate: number;
  cancelRate: number;
  averageTicket: number;
  orders: number;
  newClients: number;
}

export interface Summary {
  from: string;
  to: string;
  current: Totals;
  previous: Totals & { from: string; to: string };
}

export interface RevenueSeries {
  groupBy: 'day' | 'week' | 'month';
  series: { period: string; services: number; products: number; total: number; visits: number }[];
}

export interface BarberReport {
  barbers: {
    barberId: string;
    firstName: string;
    lastName: string | null;
    photoUrl: string | null;
    isActive: boolean;
    bookings: number;
    completed: number;
    noShow: number;
    revenue: number;
    bookedMinutes: number;
    availableMinutes: number;
    utilisation: number;
  }[];
}

export interface PasswordLink {
  url: string;
  expiresAt: string;
}
