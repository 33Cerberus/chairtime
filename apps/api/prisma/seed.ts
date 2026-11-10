/**
 * Demo data for local development. WIPES the database first.
 * Run with `npm run db:seed`. Refuses to run with NODE_ENV=production.
 */
import { hash } from '@node-rs/argon2';
import {
  BookingStatus,
  DayOfWeek,
  ExceptionType,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
  Role,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { addDays, atLocal, dateToDb, dayOfWeekOf, eachDate, MINUTE, timeToDb, todayLocal, toMinutes } from '../src/common/time';
import { portraitSvg, productSvg, Vessel } from './seed-art';

config();
const prisma = new PrismaClient();

/** Password of every seeded account that can sign in. Override with SEED_PASSWORD. */
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'chairtime-demo';

// Deterministic randomness, so every seed produces the same shop.
let state = 20261110;
const rnd = () => {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)];

const artDir = join(process.cwd(), 'uploads', 'seed');
const saveArt = (name: string, svg: string) => {
  writeFileSync(join(artDir, name), svg, 'utf8');
  return `/uploads/seed/${name}`;
};

type Hours = Partial<Record<DayOfWeek, [string, string][]>>;

const BARBERS: {
  first: string;
  last: string;
  phone: string;
  title: string;
  bio: string;
  colors: [string, string, string];
  hours: Hours;
  /** Service name -> price in zł. */
  prices: Record<string, number>;
}[] = [
  {
    first: 'Kuba',
    last: 'Wójcik',
    phone: '+48600000011',
    title: 'Master barber · fades & sharp lines',
    bio: 'Twelve years behind the chair and still chasing the perfect blend. Kuba is the one to see for skin fades, crisp line-ups and cuts that grow out as well as they walk out.',
    colors: ['#e9d2b0', '#b08d57', '#1d1814'],
    hours: {
      TUESDAY: [['10:00', '14:00'], ['15:00', '19:00']],
      WEDNESDAY: [['10:00', '14:00'], ['15:00', '19:00']],
      THURSDAY: [['10:00', '14:00'], ['15:00', '19:00']],
      FRIDAY: [['10:00', '14:00'], ['15:00', '19:00']],
      SATURDAY: [['10:00', '16:00']],
    },
    prices: { 'Classic Haircut': 90, 'Skin Fade': 110, 'Beard Trim & Shape': 60, 'Haircut & Beard': 140, 'Buzz Cut': 60, "Kids' Cut": 60 },
  },
  {
    first: 'Antoni',
    last: 'Lis',
    phone: '+48600000012',
    title: 'Senior barber · classic cuts & hot towel shaves',
    bio: 'Old-school in the best sense. Antoni trained in a traditional shave parlour and brings scissor-over-comb precision, straight-razor shaves and unhurried conversation.',
    colors: ['#d9dccf', '#7c8a6e', '#1c211b'],
    hours: {
      MONDAY: [['09:00', '13:00'], ['14:00', '18:00']],
      TUESDAY: [['09:00', '13:00'], ['14:00', '18:00']],
      WEDNESDAY: [['09:00', '13:00'], ['14:00', '18:00']],
      THURSDAY: [['09:00', '13:00'], ['14:00', '18:00']],
      FRIDAY: [['09:00', '13:00'], ['14:00', '18:00']],
    },
    prices: { 'Classic Haircut': 80, 'Beard Trim & Shape': 55, 'Haircut & Beard': 125, 'Hot Towel Shave': 85, 'Grey Blending': 95, "Kids' Cut": 55 },
  },
  {
    first: 'Igor',
    last: 'Kamiński',
    phone: '+48600000013',
    title: 'Barber · beards & texture',
    bio: 'Igor shapes beards the way a tailor fits a jacket. Come for textured crops, tidy tapers and a beard that finally matches your jawline.',
    colors: ['#e6c9b8', '#a9644a', '#231815'],
    hours: {
      MONDAY: [['12:00', '16:00'], ['16:30', '20:00']],
      TUESDAY: [['12:00', '16:00'], ['16:30', '20:00']],
      WEDNESDAY: [['12:00', '16:00'], ['16:30', '20:00']],
      THURSDAY: [['12:00', '16:00'], ['16:30', '20:00']],
      SATURDAY: [['10:00', '15:00']],
    },
    prices: { 'Classic Haircut': 70, 'Skin Fade': 90, 'Beard Trim & Shape': 50, 'Haircut & Beard': 110, 'Buzz Cut': 45 },
  },
  {
    first: 'Nina',
    last: 'Dąbrowska',
    phone: '+48600000014',
    title: 'Barber · long hair & scissor work',
    bio: 'Scissor specialist with a salon background. Nina handles longer lengths, layered shapes and the awkward grow-out phase with patience and a very good eye.',
    colors: ['#cfd6de', '#5f7187', '#161b22'],
    hours: {
      MONDAY: [['10:00', '14:00'], ['15:00', '19:00']],
      WEDNESDAY: [['10:00', '14:00'], ['15:00', '19:00']],
      FRIDAY: [['10:00', '14:00'], ['15:00', '19:00']],
      SATURDAY: [['10:00', '16:00']],
    },
    prices: { 'Classic Haircut': 85, 'Long Hair Scissor Cut': 120, 'Grey Blending': 100, "Kids' Cut": 60, 'Beard Trim & Shape': 55 },
  },
];

const SERVICES: [name: string, duration: number, description: string][] = [
  ['Classic Haircut', 45, 'Consultation, wash, scissor or clipper cut, and a styled finish.'],
  ['Skin Fade', 60, 'A seamless blend down to the skin, finished with a razor-sharp line-up.'],
  ['Beard Trim & Shape', 30, 'Sculpted lines, even length, and a hot towel with beard oil to finish.'],
  ['Haircut & Beard', 75, 'The full reset: a tailored cut and a beard shaped to match.'],
  ['Hot Towel Shave', 45, 'A traditional straight-razor shave with pre-shave oil and steamed towels.'],
  ['Buzz Cut', 30, 'One length all over or a subtle taper. Quick, clean, precise.'],
  ["Kids' Cut", 30, 'For guests under 12. Patient hands and a relaxed pace.'],
  ['Long Hair Scissor Cut', 60, 'Shape, layers and movement for shoulder length and beyond.'],
  ['Grey Blending', 45, 'A soft, natural tone that takes the edge off grey without looking coloured.'],
];

const PRODUCTS: {
  name: string;
  label: string;
  sub: string;
  category: string;
  price: number;
  stock: number;
  vessel: Vessel;
  colors: [string, string, string];
  description: string;
}[] = [
  { name: 'Matte Clay', label: 'Matte Clay', sub: 'strong hold · 100 ml', category: 'Styling', price: 85, stock: 24, vessel: 'jar', colors: ['#e8e1d5', '#2b2622', '#b08d57'], description: 'A dry, pliable clay with strong hold and zero shine. Works a little warmth through textured crops and messy fringes, and washes out without a fight.' },
  { name: 'Classic Pomade', label: 'Pomade', sub: 'medium shine · 100 ml', category: 'Styling', price: 79, stock: 18, vessel: 'tin', colors: ['#e3d7c5', '#6b2d2a', '#c9a15e'], description: 'Water-based pomade for side parts and slick-backs. Combs through cleanly, holds its shape all day and rinses out with water alone.' },
  { name: 'Sea Salt Spray', label: 'Sea Salt', sub: 'texture · 200 ml', category: 'Styling', price: 69, stock: 31, vessel: 'spray', colors: ['#dbe4e6', '#8fa9ad', '#1f2a2c'], description: 'Light, beachy texture and lift at the roots. Use it as a pre-styler before blow-drying or on its own for an undone finish.' },
  { name: 'Texture Powder', label: 'Texture Powder', sub: 'volume · 20 g', category: 'Styling', price: 59, stock: 3, vessel: 'bottle', colors: ['#ece6dc', '#d8cdbd', '#2b2622'], description: 'Weightless volume in a shake. A pinch at the roots gives grip and a matte, lived-in texture to fine or flat hair.' },
  { name: 'Beard Oil — Cedar & Bergamot', label: 'Beard Oil', sub: 'cedar & bergamot · 30 ml', category: 'Beard', price: 89, stock: 20, vessel: 'bottle', colors: ['#e9dcc2', '#8a5a2b', '#1d1814'], description: 'A fast-absorbing blend of argan and jojoba that softens the beard and calms the skin underneath. Warm cedar, bright bergamot, never greasy.' },
  { name: 'Beard Balm', label: 'Beard Balm', sub: 'light hold · 60 ml', category: 'Beard', price: 75, stock: 14, vessel: 'tin', colors: ['#dfe2d6', '#4d5a44', '#b08d57'], description: 'Shea butter and beeswax tame strays and give light shape to longer beards while keeping them conditioned through the day.' },
  { name: 'Daily Shampoo', label: 'Daily Shampoo', sub: 'gentle cleanse · 250 ml', category: 'Hair care', price: 65, stock: 27, vessel: 'bottle', colors: ['#e2e0db', '#33383d', '#c9a15e'], description: 'A sulphate-free everyday wash that lifts product build-up without stripping the scalp. Peppermint and tea tree leave it feeling properly clean.' },
  { name: 'Conditioner', label: 'Conditioner', sub: 'lightweight · 250 ml', category: 'Hair care', price: 65, stock: 22, vessel: 'bottle', colors: ['#ebe5da', '#bfae95', '#33383d'], description: 'Lightweight moisture that detangles and softens without weighing hair down. Rinse after a minute; leave a little in for longer lengths.' },
  { name: 'Shave Cream', label: 'Shave Cream', sub: 'rich lather · 150 ml', category: 'Shave', price: 72, stock: 16, vessel: 'tube', colors: ['#dde3e2', '#f1ece2', '#2f4a46'], description: 'A dense, cushioning lather with glycerin and aloe for a close shave and no tightness afterwards. Brush or fingers, both work.' },
  { name: 'Aftershave Balm', label: 'Aftershave', sub: 'alcohol-free · 100 ml', category: 'Shave', price: 95, stock: 0, vessel: 'bottle', colors: ['#e6dfd2', '#1f3a36', '#c9a15e'], description: 'Alcohol-free balm that cools razor burn and rehydrates. A quiet scent of vetiver and black pepper that fades within the hour.' },
  { name: 'Boar Bristle Brush', label: 'Bristle Brush', sub: 'beech handle', category: 'Tools', price: 120, stock: 9, vessel: 'brush', colors: ['#e7dccb', '#a9773f', '#5e3d1c'], description: 'Firm natural bristles spread oils evenly through hair and beard and train both to sit where you want them. Beech handle, made to last.' },
];

const CLIENTS: [first: string, last: string | null, canSignIn: boolean][] = [
  ['Piotr', 'Adamski', true],
  ['Michał', 'Kowalczyk', true],
  ['Tomasz', null, false], // record created at the desk: name and phone only
  ['Jan', 'Szymański', true],
  ['Filip', 'Woźniak', true],
  ['Krzysztof', 'Mazur', false],
  ['Adam', 'Krawczyk', true],
  ['Paweł', 'Piotrowski', true],
  ['Mateusz', 'Grabowski', true],
  ['Łukasz', 'Pawłowski', false],
  ['Marcin', 'Michalski', true],
  ['Bartek', 'Zając', true],
  ['Dawid', 'Król', true],
  ['Szymon', 'Wieczorek', true],
  ['Oskar', 'Jabłoński', true],
  ['Wiktor', 'Wróbel', false],
  ['Hubert', 'Majewski', true],
  ['Kacper', 'Olszewski', true],
];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('The seed wipes the database and must not run in production.');
  mkdirSync(artDir, { recursive: true });

  console.log('Clearing existing data…');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "Notification","WebhookEvent","Payment","OrderItem","Order","CartItem","Cart","Booking",
    "ScheduleException","WorkingInterval","BarberService","Service","BarberProfile","Product",
    "OneTimeToken","RefreshToken","User" CASCADE`);

  const passwordHash = await hash(DEMO_PASSWORD);
  const today = todayLocal();
  const now = Date.now();

  // ---- People -----------------------------------------------------------------------------
  await prisma.user.create({
    data: { firstName: 'Marek', lastName: 'Zieliński', phoneNumber: '+48600000001', email: 'owner@chairtime.test', role: Role.OWNER, passwordHash },
  });
  await prisma.user.create({
    data: { firstName: 'Ola', lastName: 'Nowak', phoneNumber: '+48600000002', email: 'desk@chairtime.test', role: Role.ADMIN, passwordHash },
  });

  const services = new Map<string, { id: string; duration: number }>();
  for (const [name, duration, description] of SERVICES) {
    const s = await prisma.service.create({ data: { name, duration, description } });
    services.set(name, { id: s.id, duration });
  }

  const barbers: { id: string; hours: Hours; offers: { serviceId: string; duration: number; price: number }[] }[] = [];
  for (const b of BARBERS) {
    const photoUrl = saveArt(`${b.first.toLowerCase()}.svg`, portraitSvg(`${b.first[0]}${b.last[0]}`, b.colors));
    const offers = Object.entries(b.prices).map(([name, zl]) => ({ ...services.get(name)!, price: zl * 100 }));
    const user = await prisma.user.create({
      data: {
        firstName: b.first,
        lastName: b.last,
        phoneNumber: b.phone,
        role: Role.BARBER,
        passwordHash,
        barberProfile: {
          create: {
            title: b.title,
            bio: b.bio,
            photoUrl,
            services: { create: offers.map((o) => ({ serviceId: o.id, price: o.price })) },
            workingIntervals: {
              create: Object.entries(b.hours).flatMap(([day, ranges]) =>
                ranges!.map(([start, end]) => ({ dayOfWeek: day as DayOfWeek, startTime: timeToDb(start), endTime: timeToDb(end) })),
              ),
            },
          },
        },
      },
      include: { barberProfile: true },
    });
    barbers.push({ id: user.barberProfile!.id, hours: b.hours, offers: offers.map((o) => ({ serviceId: o.id, duration: o.duration, price: o.price })) });
  }

  const clientIds: string[] = [];
  for (const [i, [firstName, lastName, canSignIn]] of CLIENTS.entries()) {
    const c = await prisma.user.create({
      data: {
        firstName,
        lastName,
        phoneNumber: `+486000000${21 + i}`,
        passwordHash: canSignIn ? passwordHash : null,
        createdAt: new Date(now - Math.floor(rnd() * 110) * 86_400_000),
      },
    });
    clientIds.push(c.id);
  }

  // ---- Schedule exceptions ------------------------------------------------------------------
  const nextOn = (day: DayOfWeek, minOffset: number) => {
    for (let i = minOffset; i < minOffset + 14; i++) if (dayOfWeekOf(addDays(today, i)) === day) return addDays(today, i);
    throw new Error('unreachable');
  };
  const kubaDayOff = nextOn('THURSDAY', 5);
  const antoniExtra = nextOn('SATURDAY', 3);
  const ninaShort = nextOn('FRIDAY', 6);
  await prisma.scheduleException.createMany({
    data: [
      { barberId: barbers[0].id, date: dateToDb(kubaDayOff), type: ExceptionType.BLOCKING, reason: 'Day off' },
      { barberId: barbers[1].id, date: dateToDb(antoniExtra), type: ExceptionType.ADDITIONAL, startTime: timeToDb('10:00'), endTime: timeToDb('14:00'), reason: 'Covering the Saturday rush' },
      { barberId: barbers[3].id, date: dateToDb(ninaShort), type: ExceptionType.BLOCKING, startTime: timeToDb('15:00'), endTime: timeToDb('19:00'), reason: 'Training course' },
    ],
  });
  const blocked = (barberIndex: number, date: string, start: number) =>
    (barberIndex === 0 && date === kubaDayOff) || (barberIndex === 3 && date === ninaShort && start >= 15 * 60);

  // ---- Bookings: ten weeks of history and two weeks ahead ---------------------------------------
  const bookings: Prisma.BookingCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const clientBusy = new Map<string, [number, number][]>();
  const isFree = (clientId: string, start: number, end: number) =>
    !(clientBusy.get(clientId) ?? []).some(([s, e]) => start < e && end > s);

  for (const date of eachDate(addDays(today, -70), addDays(today, 14))) {
    const offset = eachDate(today, date).length - 1; // 0 today, >0 future, <=0 handled below
    const future = date > today;
    // The diary fills up as a date gets closer.
    const fill = future ? Math.max(0.1, 0.42 - offset * 0.035) : 0.66;
    for (const [bi, barber] of barbers.entries()) {
      for (const [from, to] of barber.hours[dayOfWeekOf(date)] ?? []) {
        let cursor = toMinutes(from);
        const end = toMinutes(to);
        while (cursor < end) {
          const offer = pick(barber.offers);
          if (cursor + offer.duration > end || rnd() > fill || blocked(bi, date, cursor)) {
            cursor += 30;
            continue;
          }
          const startAt = atLocal(date, cursor);
          const start = startAt.getTime();
          const serviceEnd = start + offer.duration * MINUTE;
          const clientId = pick(clientIds);
          if (!isFree(clientId, start, serviceEnd)) {
            cursor += 15;
            continue;
          }
          clientBusy.set(clientId, [...(clientBusy.get(clientId) ?? []), [start, serviceEnd]]);

          let status: BookingStatus = BookingStatus.BOOKED;
          let paymentStatus: PaymentStatus = PaymentStatus.UNPAID;
          let online = false;
          const roll = rnd();
          if (serviceEnd <= now) {
            if (roll < 0.87) [status, paymentStatus] = [BookingStatus.COMPLETED, PaymentStatus.PAID];
            else if (roll < 0.93) status = BookingStatus.NO_SHOW;
            else status = BookingStatus.CANCELED;
            online = status === BookingStatus.COMPLETED && rnd() < 0.35;
          } else if (start <= now) {
            status = BookingStatus.IN_PROGRESS;
          } else if (roll < 0.3) {
            paymentStatus = PaymentStatus.PAID;
            online = true;
          }

          const id = randomUUID();
          bookings.push({
            id,
            clientId,
            barberId: barber.id,
            serviceId: offer.serviceId,
            startAt,
            endAt: new Date(serviceEnd + 15 * MINUTE),
            status,
            paymentStatus,
            priceSnapshot: offer.price,
            durationSnapshot: offer.duration,
            canceledAt: status === BookingStatus.CANCELED ? new Date(start - 26 * 3_600_000) : null,
            createdAt: new Date(Math.min(now, start) - (2 + Math.floor(rnd() * 9)) * 86_400_000),
            reminderSentAt: start < now + 86_400_000 ? new Date(start - 20 * 3_600_000) : null,
          });
          if (online) {
            payments.push({
              bookingId: id,
              amount: offer.price,
              stripePaymentIntentId: `mock_pi_seed_${id}`,
              status: PaymentAttemptStatus.SUCCEEDED,
              provider: 'mock',
            });
          }
          cursor += offer.duration + 15;
        }
      }
    }
  }
  await prisma.booking.createMany({ data: bookings });

  // ---- Products and orders ------------------------------------------------------------------
  const products: { id: string; price: number }[] = [];
  for (const p of PRODUCTS) {
    const slug = p.name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/(^-|-$)/g, '');
    const photo = saveArt(`${slug}.svg`, productSvg(p));
    const alt = saveArt(`${slug}-2.svg`, productSvg({ ...p, colors: ['#1d1814', p.colors[1] === '#2b2622' ? '#b08d57' : p.colors[1], p.colors[2]] }));
    const created = await prisma.product.create({
      data: { name: p.name, description: p.description, category: p.category, price: p.price * 100, stock: p.stock, photoUrls: [photo, alt] },
    });
    products.push({ id: created.id, price: created.price });
  }

  const codeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 52; i++) {
    const ageDays = Math.floor(rnd() * 60);
    const createdAt = new Date(now - ageDays * 86_400_000 - Math.floor(rnd() * 8) * 3_600_000);
    const lines = new Map<string, number>();
    for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) {
      const p = pick(products);
      lines.set(p.id, (lines.get(p.id) ?? 0) + 1 + Math.floor(rnd() * 2));
    }
    let status: OrderStatus = OrderStatus.RECEIVED;
    let paymentStatus: PaymentStatus = PaymentStatus.PAID;
    if (ageDays < 1) [status, paymentStatus] = [OrderStatus.CREATED, rnd() < 0.5 ? PaymentStatus.PAID : PaymentStatus.UNPAID];
    else if (ageDays < 2) [status, paymentStatus] = [OrderStatus.IN_PROGRESS, PaymentStatus.UNPAID];
    else if (ageDays < 4) [status, paymentStatus] = [OrderStatus.READY, rnd() < 0.6 ? PaymentStatus.PAID : PaymentStatus.UNPAID];
    else if (rnd() < 0.08) [status, paymentStatus] = [OrderStatus.CANCELED, PaymentStatus.UNPAID];
    const items = [...lines].map(([productId, quantity]) => ({
      productId,
      quantity,
      priceSnapshot: products.find((p) => p.id === productId)!.price,
    }));
    const totalPrice = items.reduce((sum, it) => sum + it.priceSnapshot * it.quantity, 0);
    const online = paymentStatus === PaymentStatus.PAID && rnd() < 0.5;
    const order = await prisma.order.create({
      data: {
        clientId: pick(clientIds),
        status,
        paymentStatus,
        totalPrice,
        createdAt,
        canceledAt: status === OrderStatus.CANCELED ? new Date(createdAt.getTime() + 3_600_000) : null,
        pickupCode: Array.from({ length: 6 }, () => pick([...codeAlphabet])).join(''),
        items: { create: items },
      },
    });
    if (online) {
      payments.push({
        orderId: order.id,
        amount: totalPrice,
        stripePaymentIntentId: `mock_pi_seed_${order.id}`,
        status: PaymentAttemptStatus.SUCCEEDED,
        provider: 'mock',
      });
    }
  }
  await prisma.payment.createMany({ data: payments });

  console.log(`Seeded ${BARBERS.length} barbers, ${SERVICES.length} services, ${CLIENTS.length} clients,`);
  console.log(`${bookings.length} bookings, ${PRODUCTS.length} products and 52 orders.`);
  console.log('Demo accounts and the shared demo password are listed in README.md.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
