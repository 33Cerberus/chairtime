-- Invariants from docs/data-model.md §5 that Prisma's schema language cannot express.
-- Written by hand; Prisma leaves these alone on later migrations.

-- Needed to combine equality on a uuid with range overlap in one GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Bookings of one barber never overlap, ignoring CANCELED bookings.
-- The range is [startAt, endAt): endAt already includes the 15-minute buffer, so a booking
-- may start exactly when the previous one's buffer ends.
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (
    "barberId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE ("status" <> 'CANCELED');

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_time_order" CHECK ("endAt" > "startAt"),
  ADD CONSTRAINT "Booking_price_nonnegative" CHECK ("priceSnapshot" >= 0),
  ADD CONSTRAINT "Booking_duration_quarter" CHECK ("durationSnapshot" > 0 AND "durationSnapshot" % 15 = 0);

-- Service duration is a multiple of 15 minutes.
ALTER TABLE "Service"
  ADD CONSTRAINT "Service_duration_quarter" CHECK ("duration" > 0 AND "duration" % 15 = 0);

ALTER TABLE "BarberService"
  ADD CONSTRAINT "BarberService_price_nonnegative" CHECK ("price" >= 0);

-- Product stock is never negative.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_stock_nonnegative" CHECK ("stock" >= 0),
  ADD CONSTRAINT "Product_price_nonnegative" CHECK ("price" >= 0);

-- Quantities are >= 1.
ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_quantity_positive" CHECK ("quantity" >= 1);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" >= 1),
  ADD CONSTRAINT "OrderItem_price_nonnegative" CHECK ("priceSnapshot" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_total_nonnegative" CHECK ("totalPrice" >= 0);

-- A payment references exactly one of booking or order.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_exactly_one_target" CHECK (num_nonnulls("bookingId", "orderId") = 1),
  ADD CONSTRAINT "Payment_amount_nonnegative" CHECK ("amount" >= 0);

-- Working intervals and exceptions: start before end; exception times both set or both empty;
-- an ADDITIONAL exception always has times.
ALTER TABLE "WorkingInterval"
  ADD CONSTRAINT "WorkingInterval_time_order" CHECK ("startTime" < "endTime");

ALTER TABLE "ScheduleException"
  ADD CONSTRAINT "ScheduleException_times_paired" CHECK (
    ("startTime" IS NULL AND "endTime" IS NULL)
    OR ("startTime" IS NOT NULL AND "endTime" IS NOT NULL AND "startTime" < "endTime")
  ),
  ADD CONSTRAINT "ScheduleException_additional_has_times" CHECK ("type" <> 'ADDITIONAL' OR "startTime" IS NOT NULL);

