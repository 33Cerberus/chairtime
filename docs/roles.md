# Roles and permissions

## Roles

- **Client** — books services and buys products.
- **Barber** — performs services and manages their own schedule.
- **Administrator** — runs day-to-day operations: bookings, catalog, orders.
- **Owner** — Administrator + `Create staff account` + `Change user role` + `View global analytics`.

## Legend

| Value | Meaning |
|-------|---------|
| ✓ | Allowed for any record |
| own | Allowed only for the user's own records (see below) |
| ✗ | Not allowed |

**own** for Client — records where the user is the client: bookings, orders, cart, account.

**own** for Barber — bookings assigned to the barber, their own schedule and exceptions, their public profile, their account.

## Permission matrix

| Action | Client | Barber | Administrator |
|--------|:------:|:------:|:-------------:|
| **Auth & Profile** | | | |
| Register | ✓ | ✗ | ✗ |
| View account | own | own | ✓ |
| Edit account | own | own | ✓ |
| Create client account | ✗ | ✗ | ✓ |
| Create staff account | ✗ | ✗ | ✗ |
| Change user role | ✗ | ✗ | ✗ |
| Deactivate user | own | ✗ | ✓ |
| Reactivate user | ✗ | ✗ | ✓ |
| Reset own password by phone code | ✓ | ✓ | ✓ |
| Issue a single-use password link | ✗ | ✗ | ✓ |
| **Booking** | | | |
| Create booking | own | ✗ | ✓ |
| Move booking | own | ✗ | ✓ |
| Cancel booking | own | ✗ | ✓ |
| View booking details | own | own | ✓ |
| View bookings | own | own | ✓ |
| Change booking status | ✗ | own | ✓ |
| Change booking payment status | ✗ | ✗ | ✓ |
| Pay for booking online | own | ✗ | ✗ |
| **Barbers** | | | |
| Edit public barber profile | ✗ | own | ✓ |
| Upload barber photo | ✗ | own | ✓ |
| View public barber profile | ✓ | ✓ | ✓ |
| **Schedule** | | | |
| Edit weekly schedule | ✗ | own | ✓ |
| Create exception | ✗ | own | ✓ |
| Delete exception | ✗ | own | ✓ |
| View available slots | ✓ | ✓ | ✓ |
| View schedule | ✗ | own | ✓ |
| **Services** | | | |
| Create service | ✗ | ✗ | ✓ |
| Modify service | ✗ | ✗ | ✓ |
| Deactivate service | ✗ | ✗ | ✓ |
| Manage barber's services and prices | ✗ | ✗ | ✓ |
| View services catalog | ✓ | ✓ | ✓ |
| **Store** | | | |
| Create product | ✗ | ✗ | ✓ |
| Edit product | ✗ | ✗ | ✓ |
| Deactivate product | ✗ | ✗ | ✓ |
| View products catalog | ✓ | ✓ | ✓ |
| Manage own cart | ✓ | ✓ | ✓ |
| **Orders** | | | |
| Create order | own | own | ✓ |
| Cancel order | own | own | ✓ |
| View orders | own | own | ✓ |
| Change order status | ✗ | ✗ | ✓ |
| Change order payment status | ✗ | ✗ | ✓ |
| Pay for order online | own | own | own |
| **Analytics** | | | |
| View global analytics | ✗ | ✗ | ✗ |

## Business rules

### Accounts and roles

- The owner cannot be deactivated, and their role cannot be changed.
- An administrator can deactivate clients and barbers. Administrators can be deactivated, reactivated, edited or issued a password link only by the owner.
- Staff accounts are created without a password. The owner receives a single-use link and hands it to the staff member, who chooses their own password.
- An administrator can create a client record with a name and phone number only, without a password — for bookings or orders taken by phone or at the reception. When a person later registers with the same phone number, the account is linked to that record — after they confirm a one-time code sent to that phone, so nobody can claim another person's history.
- A barber with future bookings cannot be deactivated until those bookings are moved or canceled.
- When a client deactivates their account, their future bookings and open orders are canceled, and refunded when due. The same happens when an administrator deactivates the account.
- A barber's role cannot be changed while they have future bookings.
- Changing the password requires the current one. A password change, a role change and a deactivation sign the user out everywhere.
- The public barber profile shows name, photo, description, services and prices. Contact details are not public.

### Bookings

- A client can book up to 30 days ahead.
- A booking cannot be placed in the past or outside the barber's available hours.
- Bookings must never overlap.
- A client can cancel or move a booking up to 2 hours before the scheduled time. This limit applies to clients only; administrators can move or cancel at any time.
- Moving a booking changes only its time. Changing the barber or the service requires canceling the booking and creating a new one.
- The barber sets `NO_SHOW` after waiting up to 15 minutes for the client; the status cannot be set earlier than 15 minutes after the start.
- A visit can be started (`IN_PROGRESS`) from 30 minutes before its time, and completed only after it was started.
- Only a `BOOKED` visit can be moved or canceled.
- A client cannot hold two bookings that overlap.
- A paid booking canceled at least 2 hours before its start is refunded. When an administrator cancels later than that, no refund is due by default, but the administrator can grant one.

### Schedule

- A blocking exception cannot be created for a period that already has bookings. An administrator must move or cancel those bookings first.
- The same holds for every schedule change: weekly hours cannot be removed from under upcoming bookings, and an additional exception cannot be deleted while bookings sit inside it.
- The service must fit inside the barber's hours. The 15-minute buffer after it may run past the end of a working interval, but never into another booking.

### Catalog

- Services, barbers and products are never deleted, only deactivated.
- A deactivated service or product remains in existing bookings and orders, but cannot be booked or ordered again.

### Orders

- An order cannot be placed if there is not enough stock.
- An order can be canceled only before it reaches `RECEIVED`. Canceling returns the stock and refunds a paid order.
- An order moves one step at a time and can be handed over (`RECEIVED`) only once it is paid.
- A payment made in cash is refunded in cash: the administrator hands it back and sets `REFUNDED`.

### Statuses

- Terminal statuses cannot be changed: `COMPLETED`, `CANCELED`, `NO_SHOW` for bookings; `RECEIVED`, `CANCELED` for orders.
