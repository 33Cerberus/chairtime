# Decisions

The earlier revisions of these documents left several questions open (`TODO` in `api.md`) and a few
rules contradicted or left gaps between documents. This file records what was decided, and why.
The other documents have been updated to match; this is the reasoning behind them.

## 1. Open questions from `api.md`

| Question | Decision | Why |
|---|---|---|
| Where does the refresh token live? | In an `httpOnly`, `SameSite=Lax` cookie scoped to `/api/v1/auth`. The access token stays in memory in the browser. | Script can never read the long-lived secret, so an XSS bug cannot steal a session. `Lax` plus `POST` keeps other sites from triggering a refresh. |
| Rotation? | Rotated on every refresh; reuse of a rotated token revokes the whole family; 10-second grace. | Standard theft detection. The grace period keeps two tabs refreshing together from signing the user out. |
| What does logout invalidate? | The refresh token family of that device. Access tokens are not tracked. | With a 15-minute access token a blocklist buys little. Deactivation and role changes still act at once, because the user is loaded on every request. |
| How does a staff member get a password? | `POST /users/staff` returns a single-use link (72 h). The owner hands it over; the person chooses their own password. | Nobody but the staff member ever knows the password, and no e-mail infrastructure is required. The same link doubles as an admin-issued reset. |
| New working hours that leave bookings outside? | Refused with `409 BOOKINGS_IN_THE_WAY`, listing the bookings. | Consistent with the existing rule for blocking exceptions. A booking is a promise to a client; the schedule may not silently break it. |
| Deleting an additional exception that has bookings? | Refused with the same `409`. | Same reasoning: the bookings would be outside working hours. |
| Slot response format? | See `api.md` §2.6: service-level `duration` and `price`, and per slot `startAt`, `endAt` (service end) and local `time`. | Everything a booking screen needs in one request, with moments in UTC and a ready-made local label. |
| Is stock returned when an order is canceled? | Yes. | `domain.md` §5 already says so; the `TODO` was stale. |
| Product photo upload? | `POST /products/:id/photos`, S3 when configured, local disk otherwise. | The project must run without cloud credentials. |
| List of reports? | Summary, revenue by period, barbers (utilisation), services, products. | Covers "revenue by period, barber utilisation" from `scope.md`, plus what an owner asks next. |

## 2. Gaps found between the documents

**Linking an account to a phone record was an account takeover.** `roles.md` links a new registration
to an admin-created record with the same phone. Anyone who typed someone else's number would have
inherited that person's bookings. Registration on such a number now requires a one-time code sent
to the phone. New numbers register without a code, as before.

**"View schedule" had no endpoint.** `roles.md` grants it to barbers (own) and administrators, but
`api.md` only exposed the raw weekly intervals and exceptions. Added `GET /barbers/:id/schedule`,
which returns the resolved hours per date.

**The buffer and the end of the day.** A booking occupies duration + 15 minutes. Read literally, the
last 15 minutes before every break and every closing time could never be sold. Decision: the
*service* must fit inside the working interval; the buffer may run past its end, but must never
overlap another booking. A 45-minute cut can end exactly at closing time.

**A barber profile "exists only for users with role BARBER".** Bookings reference the profile, so it
cannot be deleted when a barber changes role. The profile row is kept and simply stops being listed;
the role cannot change while the barber has upcoming bookings. Becoming a barber again reuses it.

**Cash and refunds.** `Payment` records only online attempts, so a canceled cash-paid booking has
nothing to refund through Stripe. Canceling reports `refund: "manual"`; the administrator hands the
money back and sets `REFUNDED`. Administrators can also correct a mistaken `PAID` back to `UNPAID`,
but only when no online payment exists.

**Refunds when an administrator cancels late.** Clients cannot cancel inside the 2-hour window at all;
administrators can. By default the 2-hour rule decides whether a paid booking is refunded, and the
administrator can override it either way (`refund`), because the shop may be the one canceling.

**No way back from deactivation.** Users are never deleted, but nothing could reactivate one. Added
`POST /users/:id/activate`.

**No password reset.** Added a self-service reset by one-time code, and admin-issued links.

**Changing a password.** `PATCH /users/me` now requires the current password, so a borrowed session
cannot lock the owner of the account out.

**When can statuses change?** `IN_PROGRESS` from 30 minutes before the start (early arrivals);
`NO_SHOW` only after the 15 minutes of waiting from `domain.md`; `COMPLETED` only after
`IN_PROGRESS`. Only a `BOOKED` visit can be moved or canceled.

**Handing over unpaid goods.** An order cannot become `RECEIVED` until it is paid.

**A client in two chairs at once.** A client cannot hold two bookings that overlap.

**Open orders on deactivation.** Deactivating an account cancels open orders as well as upcoming
bookings, restoring stock and refunding where due.

**Paying for something that no longer exists.** If a payment succeeds after its booking or order was
canceled (or paid in cash meanwhile), it is refunded automatically.

**Phone format.** Numbers are normalised to E.164, so `600 100 200`, `+48600100200` and
`0048 600-100-200` are one number and uniqueness means what it says.

**Reminders.** The channel was never chosen. Messages go through one `NotificationsService`
(console transport today) and are kept in a `Notification` log the client can read. Reminders are
sent the day before, between 9:00 and 21:00 shop time; moving a booking re-arms its reminder.

## 3. Improvements beyond the documents

- `actions` on bookings and orders: the server tells each caller what they may do right now.
- `GET /barbers/:id/slots/calendar`: free-slot counts per day, so a date picker needs one request.
- Machine-readable `code` on conflict errors.
- Random `pickupCode` on orders (random, so it reveals no volumes — same reasoning as UUIDs).
- Product `category`, barber `title`, booking `note`, `cancelReason`.
- Rate limiting, with a tighter limit on sign-in endpoints.
- Idempotent Stripe webhooks; a mock payment provider for local development.
- Database checks for every invariant the database can enforce (see `data-model.md` §5).

## 4. Not done

- **Mobile client** (milestone 4). The API is ready for it (`X-Client-Type: mobile`), the app is not built.
- **SMS / e-mail delivery.** Messages and codes are logged, not sent. Plug a gateway into `NotificationsService`.
- **Deployment.** Runs locally; nothing is deployed.
