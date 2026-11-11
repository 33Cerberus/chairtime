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
| Owner | +48 600 000 001 | Everything, plus staff accounts, analytics and the staff activity log |
| Administrator | +48 600 000 002 | Calendar, bookings, orders, clients, services, team, products |
| Barber (Kuba) | +48 600 000 011 | Own day, working hours, time off, public profile |
| Client (Piotr) | +48 600 000 021 | Own bookings, orders, profile |
| Phone-only record (Tomasz) | +48 600 000 023 | Cannot sign in — register with this number to try account linking |

In development the sign-in page has one-click buttons for the four roles.

## Development conveniences

With `NODE_ENV=development` (as in `.env.example`) everything works without outside services:

- **Payments** run on a built-in test checkout that settles instantly.
- **Text messages** — reminders, confirmations, one-time codes — are printed to the API log, and
  codes are also shown on screen.
- **Photos** are stored under `apps/api/uploads`.

None of this is available in production: there, payments need Stripe, text messages need an SMS
gateway, and what is not configured is switched off rather than simulated. `NODE_ENV` unset
counts as production.

## Running it for a real shop

See **[docs/operations.md](docs/operations.md)** — deployment with Docker, the first owner
account, configuration, backups, monitoring, the security model and known limits.

In short:

```bash
cp .env.production.example .env.production
```

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec app node dist/cli/create-owner.js "First" "Last" "+48 600 000 001"
```

The shop's address, phone number and opening hours are in `apps/web/src/lib/shop.ts`.

## Checks

```bash
npm test
```

Unit tests of the scheduling maths (slots, exceptions, buffers).

```bash
npm run smoke -w apps/api
```

End-to-end test against the running API with seeded data: booking rules, permissions, payments
and refunds, stock, account linking, staff accounts, reports, sessions, sign-in lockout, upload
checks, simultaneous requests and the audit trail. It creates and cancels records, so re-seed
afterwards. Wait a minute between runs: it signs in often enough to meet the rate limit twice.

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
  src/audit                   staff activity trail
  src/cli                     create-owner, password-link
  src/common/runtime.ts       configuration and start-up checks
apps/web
  src/pages                   public site, booking, shop, account
  src/pages/staff             barber, front desk and owner screens
  src/components              design system and shared dialogs
docs
  domain.md, roles.md         the business and its rules
  data-model.md, api.md       entities and endpoints
  decisions.md                how the open questions were settled
  operations.md               deploying and running it for a real shop
  scope.md                    milestones and their state
```

## Not included yet

A mobile app; a privacy notice and terms of service; data export and erasure on request. The
Stripe and SMS integrations are written but have not been run against the real services, and
the production stack has not been deployed to a server — see `docs/operations.md` §10.
