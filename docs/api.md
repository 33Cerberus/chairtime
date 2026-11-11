# API

Describes the HTTP API of Chairtime. Relies on `roles.md` and `data-model.md`.

Request and response bodies are not described here in full: they are generated from code by Swagger (`@nestjs/swagger`) and served at `/api/docs`. This document fixes the conventions, the list of endpoints and who can call them. Where a decision was open in an earlier revision, the outcome is recorded here and the reasoning in `decisions.md`.

## 1. Conventions

### Base URL

`/api/v1`

If a change breaks current clients, `/api/v2` appears, while `v1` continues to work until old clients are updated.

### Auth

- Header: `Authorization: Bearer <access token>`
- No token or invalid token — `401`
- Valid token, but the role is not allowed — `403`
- Another user's record requested through an `own` permission — `404`, so the API does not reveal that the record exists
- The user is loaded on every request, so a deactivation or a role change takes effect at once, not when the token expires
- Token refresh — see 2.1

### Access values

| Value | Meaning |
|---|---|
| Public | No token needed |
| Any | Any signed-in user |
| Client own / Barber own | Only the user's own records, as defined in `roles.md` |
| Admin | Administrator and Owner |
| Owner | Owner only |

### Formats

- JSON, fields in camelCase
- IDs — UUID strings
- Moments (bookings, orders) — ISO 8601 in UTC, e.g. `2026-10-01T14:30:00Z`
- Calendar dates — `YYYY-MM-DD`, local Europe/Warsaw date
- Time of day in the schedule — `HH:mm`, local Europe/Warsaw time, on a 15-minute step
- Money — integer in grosze, `4500` = 45.00 zł
- Phone numbers — E.164. A bare 9-digit number is read as Polish (`+48`)

### Errors

- Body: `statusCode`, `message`, `error`, and where they apply `code` and `details`
- `code` — a stable machine-readable reason for a `409`, e.g. `SLOT_TAKEN`, `OUT_OF_STOCK`, `BOOKINGS_IN_THE_WAY`
- `details` — field-level validation errors as `[{ field, errors[] }]`, or data about the conflict
- `400` — invalid request (format, validation). Unknown fields are rejected
- `401` — missing or invalid token
- `403` — the role is not allowed
- `404` — not found
- `409` — the request is valid, but conflicts with the current state, e.g. the slot is already taken, the phone is already registered, a time rule from `roles.md` is broken
- `429` — rate limit: 300 requests a minute per address, 20 a minute on sign-in endpoints. Also `429 ACCOUNT_LOCKED` when sign-in is paused for a phone number (2.1)
- `503` — a feature that depends on an outside service is not configured, e.g. no SMS gateway for one-time codes
- A `500` carries a `requestId`; every response has an `X-Request-Id` header to quote when reporting a problem

### Pagination

- Offset: parameters `page` and `limit`, `limit` is 20 by default, 100 max
- Response: `items` and `total`
- Applies to lists marked *Paginated* below

### Allowed actions

Bookings and orders carry an `actions` object saying what the caller may do with the record right now (`move`, `cancel`, `pay`, `start`, …). The rules of `roles.md` are evaluated on the server; clients render buttons from `actions` instead of re-implementing them.

## 2. Endpoints

### 2.1 Auth

Sessions use a short-lived access JWT (15 minutes) and an opaque refresh token (30 days).

- **Where the refresh token lives.** In an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production) scoped to `/api/v1/auth`. Script cannot read it. Only its SHA-256 is stored. Clients that cannot use cookies (mobile) send `X-Client-Type: mobile` to receive it in the body and pass it back as `refreshToken`.
- **Rotation.** Every refresh issues a new token and revokes the old one. Presenting a token that was already rotated away revokes its whole family, which signs that device out. A token rotated less than 10 seconds ago is still accepted once, so two tabs refreshing together are not mistaken for theft.
- **What logout invalidates.** The refresh token family of that device. The access token is not tracked and simply expires. A password change, a role change or a deactivation revokes every session of the user.

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/auth/register` | Public | Phone is required and unique, email is optional. Phone already belongs to an account — `409 PHONE_TAKEN`. Phone belongs to an admin-created client record — `409 PHONE_VERIFICATION_REQUIRED` and a 6-digit code is sent to that phone; repeating the request with `code` links the account to the record |
| POST | `/auth/login` | Public | Phone and password. Returns an access token and the user; sets the refresh cookie. After 8 wrong passwords in a row for one phone number, sign-in for that number pauses for 15 minutes — `429 ACCOUNT_LOCKED`. The count is kept per number whether or not an account exists, so it reveals nothing |
| POST | `/auth/refresh` | Public | Reads the refresh cookie (or `refreshToken` in the body). Returns a new access token and rotates the refresh token |
| POST | `/auth/logout` | Public | Reads the refresh cookie, so it works with an expired access token. `204` |
| POST | `/auth/set-password` | Public | `token` from a single-use link (see `/users/staff`), `password`. Signs the user in |
| POST | `/auth/password-reset/request` | Public | `phoneNumber`. Sends a 6-digit code. Always answers the same, whether or not the number exists |
| POST | `/auth/password-reset` | Public | `phoneNumber`, `code`, `password`. Signs the user in and revokes other sessions |

One-time codes expire after 10 minutes, allow 5 attempts and work once. With `NODE_ENV` set to `development` or `test` the code is also returned as `devCode`. In production it is only ever sent by SMS; when no SMS gateway is configured, the endpoints that need a code answer `503`.

Passwords need at least 8 characters and must not be one of the commonly used ones.

`/auth/refresh` and `/auth/logout` act on the cookie alone, so a browser request to them must come from the web app's own origin (`403` otherwise). Requests without an `Origin` header — mobile apps, scripts — are not affected.

### 2.2 Users

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/users/me` | Any | |
| PATCH | `/users/me` | Any | Name, email, phone, password. A new password requires `currentPassword`. New phone already in use — `409` |
| POST | `/users/me/deactivate` | Client own | Future bookings and open orders are canceled, refunded when due |
| GET | `/users/me/notifications` | Any | Messages the shop sent to this account |
| GET | `/users` | Admin | Filters: `role`, `isActive`, `search` by name or phone. Paginated |
| GET | `/users/:id` | Admin | |
| PATCH | `/users/:id` | Admin | Same fields as `/users/me` except password. Administrators — only by Owner |
| POST | `/users/clients` | Admin | Name and phone only, no password. Phone already in use — `409` |
| POST | `/users/staff` | Owner | Creates a barber or an administrator. A barber also gets a `BarberProfile`. The account has no password: the response carries `passwordLink` — a single-use link, valid 72 hours, that the owner hands over and the staff member opens to choose their own password |
| POST | `/users/:id/password-link` | Admin | Issues a fresh single-use link (lost invite, forgotten password). Administrators — only by Owner |
| PATCH | `/users/:id/role` | Owner | The owner's role cannot be changed. A barber with future bookings — `409` |
| POST | `/users/:id/deactivate` | Admin | The owner cannot be deactivated. Administrators — only by Owner. Barber with future bookings — `409` |
| POST | `/users/:id/activate` | Admin | Reverses a deactivation. Administrators — only by Owner |

Deactivation is a separate action, not a field change, because it has side effects and its own rules.

### 2.3 Barbers

`:id` is the `BarberProfile` id. Deactivating a barber is deactivating their user (2.2).

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/barbers` | Public | Active barbers only, public fields only, with their active services and prices |
| GET | `/barbers/:id` | Public | Name, photo, title, description, active services with this barber's prices. No contact details |
| PATCH | `/barbers/:id` | Barber own, Admin | `title`, `bio`; `photoUrl: null` removes the photo |
| POST | `/barbers/:id/photo` | Barber own, Admin | Multipart, field `file`. JPEG, PNG, WebP or AVIF, up to 5 MB. The type is taken from the file's content, not from what the uploader declares |
| POST | `/barbers/:id/services` | Admin | Assigns a service with a price. Already assigned — `409` |
| PATCH | `/barbers/:id/services/:serviceId` | Admin | Changes the price. Existing bookings keep their `priceSnapshot` |
| DELETE | `/barbers/:id/services/:serviceId` | Admin | Physical delete. Existing bookings are not affected |

### 2.4 Services

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/services` | Admin | Duration must be a multiple of 15 min. Price is set per barber, not here |
| PATCH | `/services/:id` | Admin | Deactivation: set `isActive` to `false`. Services are never deleted |
| GET | `/services` | Public | Only active services, except for Admin. Each carries `priceFrom` and `priceTo` across active barbers (`null` when nobody offers it yet) and `barberIds` |

### 2.5 Schedule

Working hours are replaced as a whole day or a whole week, hence `PUT`.

A schedule change is never allowed to leave an upcoming booking outside the barber's hours. The same check guards all three operations below: it answers `409 BOOKINGS_IN_THE_WAY` and lists the bookings in `details.bookings`. They must be moved or canceled first.

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/barbers/:id/working-hours` | Barber own, Admin | Weekly intervals, grouped by day |
| PUT | `/barbers/:id/working-hours` | Barber own, Admin | Replaces the whole week. New hours that leave existing bookings outside — `409` |
| PUT | `/barbers/:id/working-hours/:dayOfWeek` | Barber own, Admin | Replaces one day. Empty list — day off. Same `409` |
| GET | `/barbers/:id/exceptions` | Barber own, Admin | Filters: `from`, `to` |
| POST | `/barbers/:id/exceptions` | Barber own, Admin | Blocking exception over existing bookings — `409`. A past date — `400` |
| DELETE | `/barbers/:id/exceptions/:exceptionId` | Barber own, Admin | Deleting an additional exception that already has bookings inside it — `409` |
| GET | `/barbers/:id/schedule` | Barber own, Admin | "View schedule" from `roles.md`: resolved working hours per date over `from`–`to` (max 62 days), i.e. weekly hours with exceptions applied |

### 2.6 Slots

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/barbers/:id/slots` | Public | Parameters: `serviceId`, `date`, optional `excludeBookingId` (when moving a booking its own time counts as free) |
| GET | `/barbers/:id/slots/calendar` | Public | Parameters: `serviceId`, `from`, `to` (max 62 days). Number of free slots per day, for a date picker |

Response of `/slots`:

```json
{
  "barberId": "…", "serviceId": "…",
  "date": "2026-11-12", "timezone": "Europe/Warsaw",
  "duration": 60, "bufferMinutes": 15, "price": 11000,
  "slots": [
    { "startAt": "2026-11-12T12:00:00.000Z", "endAt": "2026-11-12T13:00:00.000Z", "time": "13:00" }
  ]
}
```

`endAt` of a slot is when the service ends; the buffer after it is not the client's time. `time` is the local start, for display. A slot is offered when the service fits inside the barber's hours and the service plus its buffer overlaps no other booking. The buffer itself may run past the end of a working interval.

Response of `/slots/calendar`: `days: [{ date, slotCount, firstTime }]`.

### 2.7 Bookings

Canceling is a separate action because a barber can change statuses but cannot cancel.

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/bookings` | Client own, Admin | `barberId`, `serviceId`, `startAt`, optional `note`. Admin also passes `clientId`. The server computes `endAt` (duration + 15 min buffer) and the snapshots. Overlap — `409 SLOT_TAKEN`. The client already has a visit at that time — `409 CLIENT_BUSY` |
| GET | `/bookings` | Client own, Barber own, Admin | Filters: `from`, `to`, `status` (one or several, comma-separated), `barberId`, `clientId` (Admin), `order`. Paginated |
| GET | `/bookings/:id` | Client own, Barber own, Admin | |
| PATCH | `/bookings/:id` | Client own, Admin | Move: only `startAt` changes. Only a `BOOKED` booking. Client — at least 2 h before start |
| POST | `/bookings/:id/cancel` | Client own, Admin | Only a `BOOKED` booking. Client — at least 2 h before start. Optional `reason`. A paid booking is refunded when canceled at least 2 h before; Admin can override with `refund: true/false`. The response adds `refund`: `none`, `refunding`, `refunded`, or `manual` (paid in cash — hand it back and set `REFUNDED`) |
| PATCH | `/bookings/:id/status` | Barber own, Admin | `IN_PROGRESS` (from 30 min before start), `COMPLETED` (after `IN_PROGRESS`), `NO_SHOW` (from 15 min after start). `CANCELED` only through `/cancel`. Terminal statuses cannot change — `409` |
| PATCH | `/bookings/:id/payment-status` | Admin | Manual changes: `UNPAID → PAID` (cash), `PAID → UNPAID` (correction, cash only), `PAID → REFUNDED` (cash handed back; for an online payment this starts a real refund and the status becomes `REFUNDING`) |
| POST | `/bookings/:id/payments` | Client own | Starts an online payment. Returns `paymentId`, `provider`, `clientSecret`, `publishableKey`. Reopening returns the same open attempt |

### 2.8 Products

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/products` | Public | Only active products, except for Admin. Filters: `search`, `category`. Also returns the list of `categories`. Paginated |
| GET | `/products/:id` | Public | |
| POST | `/products` | Admin | |
| PATCH | `/products/:id` | Admin | Deactivation: set `isActive` to `false`. `photoUrls` may reorder or remove existing photos |
| POST | `/products/:id/photos` | Admin | Multipart, field `file`. Up to 8 photos; the first is the one shown in the catalog |

Photos are stored in S3 when `S3_BUCKET` is configured, and on local disk under `/uploads` otherwise.

### 2.9 Cart

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/cart` | Any | Own cart, with totals and an `available` flag per line |
| PUT | `/cart/items/:productId` | Any | Sets the quantity; adds the item if it is not in the cart. More than the stock — `409` |
| DELETE | `/cart/items/:productId` | Any | |
| DELETE | `/cart` | Any | Empties the cart |

### 2.10 Orders

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/orders` | Client own, Barber own, Admin | Created from the caller's cart, then the cart is emptied. Admin can instead pass `clientId` and items. Not enough stock — `409 OUT_OF_STOCK`. Stock is taken atomically for the whole order |
| GET | `/orders` | Client own, Barber own, Admin | Filter: `status` (one or several), `clientId` (Admin). Paginated |
| GET | `/orders/:id` | Client own, Barber own, Admin | |
| POST | `/orders/:id/cancel` | Client own, Barber own, Admin | Only before `RECEIVED`. Stock is returned. A paid order is refunded; the response adds `refund` as for bookings |
| PATCH | `/orders/:id/status` | Admin | One step at a time: `IN_PROGRESS`, `READY`, `RECEIVED`. `RECEIVED` requires the order to be paid — `409 UNPAID` otherwise. `CANCELED` only through `/cancel`. Terminal statuses cannot change — `409` |
| PATCH | `/orders/:id/payment-status` | Admin | Manual changes, same rules as for bookings |
| POST | `/orders/:id/payments` | Any | Own orders only. Starts an online payment |

Every order has a short random `pickupCode` the client shows at the desk.

### 2.11 Payments and webhooks

With `STRIPE_SECRET_KEY` set, payments go through Stripe (PaymentIntents) and are confirmed by webhooks. Without it, in development the API runs a mock provider, so the whole flow works locally. In production without Stripe the provider is `none`: online payment is switched off, the `pay` action is `false` everywhere, and starting a payment answers `409 ONLINE_PAYMENTS_UNAVAILABLE`.

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/payments/config` | Public | `provider` (`stripe`, `mock` or `none`), `publishableKey`, `currency` |
| POST | `/payments/:id/mock-confirm` | Any | Mock provider only: settles an own payment as `succeeded` or `failed`. Disabled when Stripe is configured |
| POST | `/webhooks/stripe` | Stripe | Verified by the Stripe signature, not by JWT. Updates `Payment` and `paymentStatus`. Each event is applied once. Handles `payment_intent.succeeded`, `.payment_failed`, `.canceled`, `charge.refunded`, `refund.failed` |

A payment that succeeds for a record that was canceled or paid in the meantime is refunded automatically. Confirming, refunding and canceling are each applied once, even when the same request or webhook arrives twice at the same moment. When the provider refuses a refund, `refund` is `failed` and the record stays `PAID` so it can be retried.

### 2.12 Reports

All take `from` and `to` (local dates, inclusive; default the last 30 days; max 400 days). Revenue is money actually taken: records whose payment status is `PAID`.

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/reports/summary` | Owner | Revenue (services, products), visits by outcome, no-show and cancellation rates, average ticket, orders, new clients — with the same figures for the previous period of equal length |
| GET | `/reports/revenue` | Owner | Revenue by period, split into services and products. `groupBy`: `day`, `week`, `month` |
| GET | `/reports/barbers` | Owner | Per barber: visits, no-shows, revenue, booked and available minutes, utilisation |
| GET | `/reports/services` | Owner | Most booked services |
| GET | `/reports/products` | Owner | Best selling products |

### 2.13 Audit log

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/audit-log` | Owner | Every state-changing request made by a barber, an administrator or the owner: who, which action (method and route pattern), the record acted on, the outcome, and when. Refused attempts are included. Filter: `actorId`. Paginated. Kept for 400 days. Request bodies are not stored |

### 2.14 Health

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/health` | Public | Checks the database connection |
