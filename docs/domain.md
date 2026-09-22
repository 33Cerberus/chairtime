# Domain

## 1. About the business

Chairtime is a booking and management system for a single-branch local barbershop.

The shop employs several barbers with different skill sets. Each barber works
their own hours, provides their own set of services, and may charge a different
price for the same service. Besides haircuts, the shop sells retail products
(styling products, cosmetics, and similar).

**Deliberate scope limits:**

- One location, not a chain.
- Not a marketplace — clients arrive via a direct URL, there is no search across shops.
- Single language, single currency.
- Every booking and order belongs to a client record. Clients create an account
  themselves; an administrator can create a client record by phone or at the
  reception. There is no anonymous booking.

## 2. Users

**Client** — books haircuts. Picks a service, a barber, and an available slot.
Can move or cancel a booking, and can view the full history of their bookings.
Can also buy products from the catalog.

**Barber** — sees their own schedule as a calendar. Manages their own working
hours and time off. Advances the status of their bookings through the visit.

**Administrator** — creates bookings and orders taken by phone or at the
reception desk. For clients without an account, creates a client record with
a name and phone number only. Manages barbers, services, prices, product
catalog and stock, and handles product orders. Can cancel or move any booking.

**Owner** — inherits all Administrator permissions, and additionally creates
staff accounts, assigns roles, and has access to the statistics section.

## 3. Client path

| Step | Description | What happens in the system |
|------|-------------|----------------------------|
| 1 | Registers with name, surname, and phone number; email is optional | A user record is created, or linked to an existing client record with the same phone number |
| 2 | Picks a single service from the catalog | The catalog is read from the database |
| 3 | Picks a barber and one of their available slots | Available slots are calculated from the barber's schedule, exceptions, and existing bookings |
| 4 | Confirms the booking, optionally paying online | A booking is created with status `BOOKED` and payment status `PAID` or `UNPAID` |
| 5 | Receives an automatic reminder the day before the visit | A scheduled job sends the reminder |
| 6 | Arrives at the shop on the day of the visit | The barber sets the status to `IN_PROGRESS` |
| 7 | Gets the service done | The barber sets the status to `COMPLETED` |
| 8 | Pays at the shop, if not paid online | Payment status becomes `PAID` |

**Alternative paths:**

| Case | What happens in the system |
|------|----------------------------|
| The client cancels the booking | Status becomes `CANCELED` |
| The client moves the booking | The booking time changes; the status is unchanged |
| The client does not show up | The barber sets `NO_SHOW` after waiting up to 15 minutes |
| A paid booking is canceled within the allowed window | Payment status becomes `REFUNDING`, then `REFUNDED` once the refund completes |
| A paid booking is canceled late, or ends as `NO_SHOW` | No refund; the payment stays `PAID` |

**Booking status**

| Status | Meaning |
|--------|---------|
| `BOOKED` | Slot is reserved, visit has not started |
| `IN_PROGRESS` | Client has arrived, service is being performed |
| `COMPLETED` | Service is finished — terminal |
| `CANCELED` | Canceled by the client or an administrator — terminal |
| `NO_SHOW` | Client did not arrive — terminal |

**Payment status:** `UNPAID`, `PAID`, `REFUNDING`, `REFUNDED`

## 4. Scheduling

### 4.1 Services and pricing

Each service has a name, a description, and a duration. The duration is the same
for every barber, and is always a multiple of 15 minutes.

The price is set per barber, so the same service can cost differently depending
on who performs it. On the service selection page the client sees the lowest
price across barbers, shown as "from X". Once a barber is selected, the exact
price is known.

Each barber has their own list of services they provide.

When a booking is created, the price and the duration of the selected service
are stored in the booking itself. Later changes to the catalog must not affect
bookings that already exist.

### 4.2 Working hours

A barber has a recurring weekly schedule — for example, Monday to Friday from
10:00 to 19:00 with a lunch break, and weekends off. The lunch break is part of
the weekly schedule, not a separate exception.

The weekly schedule is stored as working intervals — for example, Monday
10:00–14:00 and Monday 15:00–19:00. The lunch break is simply the gap between
two intervals, not a separate record or exception.

Barbers see their own working hours and bookings as a calendar.

### 4.3 Exceptions

An exception overrides the weekly schedule on a specific date. It can cover the
whole day or a range of hours within it, and it is one of two types:

- **Blocking** — the barber is unavailable (time off, sick day, personal reasons).
- **Additional** — the barber works outside their usual hours.

A blocking exception cannot be created for a period that already has bookings.
An administrator must move or cancel those bookings first.

### 4.4 Booking rules

- Slots are offered in 15-minute steps. Because services differ in duration,
  slots are not of a fixed size.
- A booking occupies the service duration plus 15 minutes for cleaning and setup.
  The next booking can only start after that buffer.
- Bookings must never overlap.
- A booking stores its start and end time, so that later changes to a service's
  duration do not shift existing bookings.
- A booking cannot be placed outside the barber's available hours, or in the past.
- A client can book up to 30 days ahead.
- A client can cancel or move a booking up to 2 hours before the scheduled time.
- Moving a booking changes only its time. Changing the barber or the service
  requires canceling the booking and creating a new one.

## 5. Store

The shop sells products from a catalog, each with a stock quantity. The client
adds products to a cart and places an order, which is collected at the shop.
There is no delivery.

When an order is placed, its status becomes `CREATED` and the stock quantity is
decreased. An administrator then prepares the order (`IN_PROGRESS`) and marks it
`READY` when done. Once handed over to the client, the order becomes `RECEIVED`.
An order can be canceled by the client or by an administrator at any point
before it is marked `RECEIVED`.

Canceling an order restores the stock quantity, and triggers a refund if the
order was already paid.

An administrator can also place an order on behalf of a client, for example by phone or at the reception.

**Order status:** `CREATED`, `IN_PROGRESS`, `READY`, `RECEIVED` (terminal), `CANCELED` (terminal)

**Payment status:** `UNPAID`, `PAID`, `REFUNDING`, `REFUNDED`

## 6. Glossary

| Term | Meaning | In code |
|------|---------|---------|
| Service | A haircut, a beard trim, a combo, and so on | `Service` |
| Booking | A reserved slot with a specific barber | `Booking` |
| Slot | A time interval available for booking | calculated |
| Working interval | One continuous working time range of a barber on a given weekday; together they form the weekly schedule | `WorkingInterval` |
| Exception | A one-time override of the weekly schedule | `ScheduleException` |
| No-show | The client did not arrive | `NO_SHOW` status |
