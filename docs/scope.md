# Scope and milestones

## Milestones

Ordered, not dated. Each one is done when the system actually works end to end
at that level, not when the code is written.

### 0 — Skeleton

Project runs locally: NestJS, PostgreSQL in Docker, Prisma schema from
`data-model.md` migrated, seed script, `User` / `Service` / `BarberProfile`
reachable through the API.

### 1 — First vertical slice

Deployed and reachable at a public URL.

- Registration and login, JWT with refresh tokens, hashed passwords.
- Role guards and ownership checks for `own` permissions.
- Admin creates client records and staff accounts; owner assigns roles.
- Service catalog: list, create, edit, deactivate.
- Barber profiles: list, view, edit, photo upload to S3.
- React front end: login, catalog, barber list. Plain, but real.
- CI running build and migrations.

### 2 — Booking (MVP)

The point of the project. From here it is a complete booking system.

- Weekly working intervals and schedule exceptions.
- Slot search: working hours minus blocking exceptions, plus additional ones,
  minus existing bookings and their buffers, in 15-minute steps.
- Creating, moving and canceling bookings, with all rules from `roles.md`.
- Client, barber and admin views.

### 3 — Store and payments

Catalog, cart, orders, Stripe in test mode, refunds, next-day reminders.

### 4 — Mobile client

Booking and history on React Native, against the same API.

### Later

Analytics: revenue by period, barber utilisation.

## Deferred technical tasks

Raised during design; each belongs to a milestone rather than to a free afternoon.

| Task | Milestone |
|------|-----------|
| Exclusion constraint against overlapping bookings, written by hand in a SQL migration | 2 |
| Stripe webhooks for payment and refund confirmation | 3 |
| Scheduled job for next-day reminders | 3 |

## Cut order

If the scope has to shrink, it shrinks in this order:

1. Analytics.
2. Mobile client — down to viewing and creating bookings only.
3. Store — orders without online payment.

The booking core is never cut.

## Not in scope

Decided against during design, kept here so they do not creep back in:
client–barber chat, reviews and ratings, loyalty points, multiple locations,
delivery, guest booking, search across shops, barber-level analytics,
automatic `NO_SHOW`.
