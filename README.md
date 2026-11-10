# Chairtime

Booking and management system for a single-branch barbershop: clients book a barber online,
barbers run their day from a calendar, the front desk handles phone bookings, the shop and
orders, and the owner sees the numbers.

- **API** — NestJS, PostgreSQL, Prisma (`apps/api`)
- **Web** — React, Vite, Tailwind CSS, TanStack Query (`apps/web`)
- **Docs** — the specification the code follows (`docs/`)

## Run it locally

Requirements: Node 20+, Docker.

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
npm run db:up
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Then, in two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

| | |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:4000/api/v1 |
| API reference (Swagger) | http://localhost:4000/api/docs |

PostgreSQL runs in Docker on host port **5433**, so it does not collide with a locally
installed PostgreSQL on 5432.

> npm 12 does not run dependency install scripts by default. If Prisma reports a missing
> client, run `npm run generate -w apps/api`.

## Demo accounts

`npm run db:seed` **wipes the database** and creates a working shop: four barbers with schedules
and prices, nine services, eleven products, eighteen clients, ten weeks of booking history and
two weeks of upcoming bookings.

Every seeded account that can sign in shares one password: `chairtime-demo`
(override with `SEED_PASSWORD` when seeding).

| Role | Phone | Sees |
|---|---|---|
| Owner | +48 600 000 001 | Everything, plus staff accounts and analytics |
| Administrator | +48 600 000 002 | Calendar, bookings, orders, clients, services, team, products |
| Barber (Kuba) | +48 600 000 011 | Own day, working hours, time off, public profile |
| Client (Piotr) | +48 600 000 021 | Own bookings, orders, profile |
| Phone-only record (Tomasz) | +48 600 000 023 | Cannot sign in — register with this number to try account linking |

In development the sign-in page has one-click buttons for the four roles.

## What works without extra setup

- **Payments** run on a built-in mock provider: checkout shows a test card and settles
  instantly. Set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET` to use
  Stripe (test mode) instead; point the webhook at `/api/v1/webhooks/stripe`.
- **Photos** are stored under `apps/api/uploads`. Set `S3_BUCKET` (and credentials) to use S3 or
  any S3-compatible store.
- **Text messages** — reminders, confirmations and one-time codes — are written to the API log
  and to each client's message history. One-time codes are also shown on screen in development.
  Connect a gateway in `apps/api/src/notifications/notifications.service.ts`.

## Checks

```bash
npm test
```

Unit tests of the scheduling maths (slots, exceptions, buffers).

```bash
npm run smoke -w apps/api
```

End-to-end test against the running API with seeded data: 73 checks across booking rules,
permissions, payments and refunds, stock, account linking, staff accounts, reports and sessions.
It creates and cancels records, so re-seed afterwards.

```bash
npm run typecheck
```

```bash
npm run build
```

## Layout

```
apps/api
  prisma/schema.prisma        data model
  prisma/migrations           SQL, including the hand-written constraints migration
  prisma/seed.ts              demo data
  src/schedule                working hours, exceptions, slot search
  src/bookings                booking rules and lifecycle
  src/payments                Stripe / mock provider, refunds, webhook
  src/orders                  cart and orders
  src/catalog                 services, barbers, products
  src/users, src/auth         accounts, roles, sessions
  src/reports                 owner analytics
apps/web
  src/pages                   public site, booking, shop, account
  src/pages/staff             barber, front desk and owner screens
  src/components              design system and shared dialogs
docs
  domain.md, roles.md         the business and its rules
  data-model.md, api.md       entities and endpoints
  decisions.md                how the open questions were settled
  scope.md                    milestones and their state
```

## Production notes

- Set `NODE_ENV=production` and a random `JWT_ACCESS_SECRET` of at least 32 characters; the API
  refuses to start otherwise.
- Serve the web build and the API from one origin (reverse proxy `/api` and `/uploads` to the
  API), so the refresh cookie stays same-site. Set `WEB_ORIGIN` and `TRUST_PROXY=1`.
- Run `npm run db:migrate` on deploy. Never run the seed against real data.
- Not included yet: the mobile client, a real SMS or e-mail gateway, deployment.
