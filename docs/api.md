# API

Describes the HTTP API of Chairtime. Relies on `roles.md` and `data-model.md`.

Request and response bodies are not described here: they are generated from code by Swagger (`@nestjs/swagger`) and served at `/api/docs`. This document fixes the conventions, the list of endpoints and who can call them.

## 1. Conventions

### Base URL

`/api/v1`

If a change breaks current clients, `/api/v2` appears, while `v1` continues to work until old clients are updated.

### Auth

- Header: `Authorization: Bearer <access token>`
- No token or invalid token — `401`
- Valid token, but the role is not allowed — `403`
- Another user's record requested through an `own` permission — `404`, so the API does not reveal that the record exists
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
- Time of day in the schedule — `HH:mm`, local Europe/Warsaw time
- Money — integer in grosze, `4500` = 45.00 zł

### Errors

- Body: `statusCode`, `message`, `error`, `details` (field-level validation errors)
- `400` — invalid request (format, validation)
- `401` — missing or invalid token
- `403` — the role is not allowed
- `404` — not found
- `409` — the request is valid, but conflicts with the current state, e.g. the slot is already taken, the phone is already registered, a time rule from `roles.md` is broken

### Pagination

- Offset: parameters `page` and `limit`, `limit` is 20 by default, 100 max
- Response: `items` and `total`
- Applies to lists marked *Paginated* below

## 2. Endpoints

### 2.1 Auth

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/auth/register` | Public | Phone is required and unique, email is optional. If an admin-created client record has the same phone, the account is linked to it. Phone already belongs to an account — `409` |
| POST | `/auth/login` | Public | Phone and password. Returns an access token |
| POST | `/auth/refresh` | Public | TODO: where the refresh token lives, rotation |
| POST | `/auth/logout` | Any | TODO: what logout invalidates |

### 2.2 Users

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/users/me` | Any | |
| PATCH | `/users/me` | Any | Name, email, phone, password. New phone already in use — `409` |
| POST | `/users/me/deactivate` | Client own | Future bookings are canceled |
| GET | `/users` | Admin | Filters: role, search by name or phone. Paginated |
| GET | `/users/:id` | Admin | |
| PATCH | `/users/:id` | Admin | Same fields as `/users/me` except password |
| POST | `/users/clients` | Admin | Name and phone only, no password. Phone already in use — `409` |
| POST | `/users/staff` | Owner | Creates a barber or an administrator. A barber also gets a `BarberProfile`. TODO: how the staff member gets a password |
| PATCH | `/users/:id/role` | Owner | The owner's role cannot be changed |
| POST | `/users/:id/deactivate` | Admin | The owner cannot be deactivated. Administrators — only by Owner. Barber with future bookings — `409` |

Deactivation is a separate action, not a field change, because it has side effects and its own rules.

### 2.3 Barbers

`:id` is the `BarberProfile` id. Deactivating a barber is deactivating their user (2.2).

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/barbers` | Public | Active barbers only, public fields only |
| GET | `/barbers/:id` | Public | Name, photo, description, active services with this barber's prices. No contact details |
| PATCH | `/barbers/:id` | Barber own, Admin | Public profile fields: photo, description |
| POST | `/barbers/:id/services` | Admin | Assigns a service with a price. Already assigned — `409` |
| PATCH | `/barbers/:id/services/:serviceId` | Admin | Changes the price. Existing bookings keep their `priceSnapshot` |
| DELETE | `/barbers/:id/services/:serviceId` | Admin | Physical delete. Existing bookings are not affected |

### 2.4 Services

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/services` | Admin | Duration must be a multiple of 15 min. Price is set per barber, not here |
| PATCH | `/services/:id` | Admin | Deactivation: set `isActive` to `false`. Services are never deleted |
| GET | `/services` | Public | Only active services, except for Admin |

### 2.5 Schedule

Working hours are replaced as a whole day or a whole week, hence `PUT`.

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/barbers/:id/working-hours` | Barber own, Admin | Weekly intervals |
| PUT | `/barbers/:id/working-hours` | Barber own, Admin | Replaces the whole week. TODO: new hours that leave existing bookings outside |
| PUT | `/barbers/:id/working-hours/:dayOfWeek` | Barber own, Admin | Replaces one day. Empty list — day off |
| GET | `/barbers/:id/exceptions` | Barber own, Admin | Filters: `from`, `to` |
| POST | `/barbers/:id/exceptions` | Barber own, Admin | Blocking exception over existing bookings — `409` |
| DELETE | `/barbers/:id/exceptions/:exceptionId` | Barber own, Admin | TODO: deleting an additional exception that already has bookings |

### 2.6 Slots

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/barbers/:id/slots` | Public | Parameters: `serviceId`, `date`. TODO: response format (milestone 2) |

### 2.7 Bookings

Canceling is a separate action because a barber can change statuses but cannot cancel.

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/bookings` | Client own, Admin | `barberId`, `serviceId`, `startAt`. Admin also passes `clientId`. The server computes `endAt` (duration + 15 min buffer) and the snapshots. Overlap — `409` |
| GET | `/bookings` | Client own, Barber own, Admin | Filters: `from`, `to`, `status`, `barberId`. Paginated |
| GET | `/bookings/:id` | Client own, Barber own, Admin | |
| PATCH | `/bookings/:id` | Client own, Admin | Move: only `startAt` changes. Client — at least 2 h before start |
| POST | `/bookings/:id/cancel` | Client own, Admin | Client — at least 2 h before start |
| PATCH | `/bookings/:id/status` | Barber own, Admin | `IN_PROGRESS`, `COMPLETED`, `NO_SHOW`. `CANCELED` only through `/cancel`. Terminal statuses cannot change — `409` |
| PATCH | `/bookings/:id/payment-status` | Admin | Manual changes, e.g. cash payment |
| POST | `/bookings/:id/payments` | Client own | Starts an online payment through Stripe. Milestone 3 |

### 2.8 Products

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/products` | Public | Only active products, except for Admin. Paginated |
| GET | `/products/:id` | Public | |
| POST | `/products` | Admin | |
| PATCH | `/products/:id` | Admin | Deactivation: set `isActive` to `false` |

Photo upload (S3): TODO, milestone 3.

### 2.9 Cart

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/cart` | Any | Own cart |
| PUT | `/cart/items/:productId` | Any | Sets the quantity; adds the item if it is not in the cart |
| DELETE | `/cart/items/:productId` | Any | |

### 2.10 Orders

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/orders` | Client own, Barber own, Admin | Created from the caller's cart, then the cart is emptied. Admin can instead pass `clientId` and items. Not enough stock — `409` |
| GET | `/orders` | Client own, Barber own, Admin | Filter: `status`. Paginated |
| GET | `/orders/:id` | Client own, Barber own, Admin | |
| POST | `/orders/:id/cancel` | Client own, Barber own, Admin | Only before `RECEIVED`. TODO: is stock returned |
| PATCH | `/orders/:id/status` | Admin | `CANCELED` only through `/cancel`. Terminal statuses cannot change — `409` |
| PATCH | `/orders/:id/payment-status` | Admin | Manual changes, e.g. cash payment |
| POST | `/orders/:id/payments` | Any | Own orders only. Online payment through Stripe. Milestone 3 |

### 2.11 Webhooks

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/webhooks/stripe` | Stripe | Verified by the Stripe signature, not by JWT. Updates `Payment` and `paymentStatus`. Milestone 3 |

### 2.12 Reports

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/reports/...` | Owner | TODO: list of reports. Milestone 4 |
