# Operations

How to run Chairtime for a real shop: deploying it, the first account, what must be configured,
backups, and what to do when something goes wrong. The reasoning behind the security choices is
in `decisions.md` §5.

## 1. What runs

One container holds the API and serves the web app, so pages, API and the session cookie share
one origin. It needs PostgreSQL 15 or newer. HTTPS is terminated by a reverse proxy in front
(`docker-compose.prod.yml` uses Caddy, which obtains and renews the certificate by itself).

```
browser ──https──▶ Caddy ──http──▶ app (API + web) ──▶ PostgreSQL
                                     └─ uploads volume (or S3)
```

## 2. Deploy

Requirements: a server with Docker, and a DNS record for your domain pointing at it.

1. Copy `.env.production.example` to `.env.production` and fill it in. `POSTGRES_PASSWORD` and
   `JWT_ACCESS_SECRET` must each be long and random (`openssl rand -base64 48`).
2. Start the stack:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```
   Migrations are applied automatically each time the app starts.
3. Create the owner (see §3).
4. Sign in, then add staff under **Team**, services under **Services**, and working hours for
   each barber. Edit the shop's address, phone and opening hours in `apps/web/src/lib/shop.ts`
   and rebuild.

To update: pull the new code and run the same `up -d --build` command.

The API refuses to start when its configuration cannot work or is not safe — a missing or weak
`JWT_ACCESS_SECRET`, a `WEB_ORIGIN` that is not `https://`, half-configured Stripe or SMS. The
reason is printed in plain words. Features that are merely switched off are listed as warnings
at start-up.

## 3. The first owner

A fresh database has no accounts, and the demo seed must never run against real data. Create
the owner from the server:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec app \
  node dist/cli/create-owner.js "Marek" "Zieliński" "+48 600 000 001"
```

It prints a single-use link (valid 72 hours). Opening it lets the owner choose a password.
There can be only one owner; the command refuses to run when one exists.

**Locked out?** Any account can be given a fresh link from the server, which also lifts a
sign-in lock:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec app \
  node dist/cli/password-link.js "+48 600 000 001"
```

## 4. Configuration

| Variable | Required | Meaning |
|---|:---:|---|
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | ✓ | Signs access tokens. At least 32 random characters in production |
| `WEB_ORIGIN` | ✓ in production | Public address of the web app, `https://…`. Several, comma-separated, are allowed |
| `NODE_ENV` | | `production`, `development` or `test`. **Unset means production** |
| `PORT` | | Default `4000` |
| `TRUST_PROXY` | | Number of reverse proxies in front (usually `1`). Needed for correct client addresses in rate limiting and the audit log |
| `WEB_DIST` | | Folder with the built web app; when set, the API serves it. Set by the Docker image |
| `SHOP_TIMEZONE` | | Default `Europe/Warsaw` |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | all or none | Online payments |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | all or none | Text messages |
| `S3_BUCKET` (+ `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`) | | Photo storage. Without it photos go to the `uploads` folder |
| `ALLOW_MOCK_PAYMENTS` | | `true` enables the test checkout in production. For a staging server only |
| `ENABLE_API_DOCS` | | `true` serves Swagger at `/api/docs` in production |
| `REFRESH_TTL_DAYS`, `JWT_ACCESS_TTL` | | Session lifetimes. Defaults: 30 days, 15 minutes |

### What is off until you configure it

| Not configured | Effect |
|---|---|
| Stripe | Online payment is hidden. Bookings and orders work; clients pay at the shop |
| SMS | No reminders or confirmations by text (they still appear in the client's message history). Password reset by code and linking an account to a phone record answer "not available"; use a password link instead |
| S3 | Photos are stored on the server's disk, in the `uploads` volume |

In production nothing is ever "simulated": without Stripe no payment can be marked as paid
online, and without SMS no code is printed anywhere.

### Stripe

Register the webhook `https://<your domain>/api/v1/webhooks/stripe` for the events
`payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`,
`charge.refunded` and `refund.failed`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
Test with Stripe's test keys on a staging server before going live — this integration has not
been exercised against Stripe yet.

## 5. Backups

Two things hold data that cannot be recreated:

- **The database** — everything except photos.
- **The `uploads` volume** — photos, unless S3 is used.

Daily database dump:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_dump -U chairtime -Fc chairtime > chairtime-$(date +%F).dump
```

Restore into an empty database:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_restore -U chairtime -d chairtime --clean --if-exists < chairtime-2026-11-10.dump
```

Keep dumps off the server, keep at least two weeks of them, and **test a restore** before you
rely on it. A backup that has never been restored is a hope, not a backup.

## 6. Watching it

- **Health:** `GET /api/v1/health` answers `200` when the API can reach the database. The Docker
  image has a health check on it; point an uptime monitor at it too.
- **Logs:** `docker compose … logs -f app`. One line per request — method, route, status, time,
  user id and a request id — and never query strings or bodies, which carry clients' names and
  phone numbers.
- **Errors:** a `500` response carries a `requestId`. Search the logs for it to find the cause.
- **Who did what:** the owner's **Activity** screen lists every change made by staff.

## 7. Housekeeping

Runs by itself every night at 03:17 shop time: expired sessions, used codes and old sign-in
counters are deleted, checkouts abandoned for a day are closed, and the staff activity log and
message history are trimmed to 400 days.

Reminders are sent the day before a visit, between 9:00 and 21:00. Both jobs assume **one**
running copy of the app. Running several copies is safe for reminders (each booking is claimed
before sending) but the rate limiter keeps its counters in memory, so its limits would apply
per copy.

## 8. Security model in brief

- Passwords are hashed with Argon2id. The most common passwords are refused.
- Sign-in is limited per address (20 a minute) and per phone number (8 wrong passwords pause
  sign-in for that number for 15 minutes, whether or not it has an account).
- Sessions: a 15-minute access token held in memory, and a refresh token in an `httpOnly`,
  `Secure`, `SameSite=Lax` cookie that is rotated on every use; reuse of an old one ends the
  session. Deactivating a user or changing their role takes effect on their next request.
- Every state change checks the caller's role and, for "own" records, ownership; another
  person's record answers `404`.
- Money and stock cannot be double-counted: bookings cannot overlap (database constraint),
  stock cannot go negative, and paying, refunding, canceling and status changes are each applied
  exactly once even when the same request arrives twice.
- Uploaded photos are checked by their content, stored under random names, and served with a
  policy that prevents them from running script.
- The web app is served with a Content Security Policy that allows only its own scripts and
  Stripe's.

## 9. Personal data

Chairtime stores names, phone numbers, optional e-mail addresses, booking and order history,
and — for staff actions — the address a request came from. It stores no card data: card details
go from the browser straight to Stripe.

- A client can close their own account (**Profile → Close your account**); an administrator can
  deactivate any client. Deactivation stops sign-in and cancels what is upcoming, but **keeps**
  the record, because past bookings and orders refer to it.
- There is no self-service data export or erasure yet. A request to erase a person's data has to
  be handled by hand in the database, and weighed against your duty to keep accounting records.
- The site sets one cookie, strictly necessary for staying signed in; no analytics or
  advertising cookies. A privacy notice and terms of service are **not** included — have them
  written for your business before going live.

## 10. Known limits

- Stripe and Twilio integrations are written but have not been run against the real services.
- The production Docker stack (including Caddy and HTTPS) has not been deployed to a server.
- No mobile app.
- One shop, one time zone, one currency (PLN), one language (English).
- The Prisma CLI's configuration loader has an open advisory (`deepmerge-ts`, fixed only in
  Prisma 7). It affects a development-time tool reading this project's own configuration, not
  the running API.
