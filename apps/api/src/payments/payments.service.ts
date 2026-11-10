import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus, OrderStatus, PaymentAttemptStatus, PaymentStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import Stripe from 'stripe';
import { AuthUser } from '../common/auth-user';
import { badRequest, conflict, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

/** A payment belongs to exactly one booking or one order. */
export type PaymentTarget = { bookingId: string } | { orderId: string };

const CURRENCY = 'pln';

/**
 * Online payments. With `STRIPE_SECRET_KEY` set, intents and refunds go through Stripe and
 * are confirmed by webhooks. Without it a mock provider takes over, so the whole flow can be
 * exercised locally: the web app shows a test checkout and confirms through /mock-confirm.
 *
 * `paymentStatus` on the booking or order is the source of truth for the interface;
 * `Payment` rows only record online attempts.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');
  private readonly stripe?: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (key) this.stripe = new Stripe(key);
    else if (this.config.get('NODE_ENV') === 'production') {
      this.logger.warn('STRIPE_SECRET_KEY is not set: online payments run on the MOCK provider.');
    }
  }

  get provider(): 'stripe' | 'mock' {
    return this.stripe ? 'stripe' : 'mock';
  }

  publicConfig() {
    return {
      provider: this.provider,
      publishableKey: this.stripe ? (this.config.get<string>('STRIPE_PUBLISHABLE_KEY') ?? null) : null,
      currency: CURRENCY,
    };
  }

  // ---- Starting a payment -----------------------------------------------------------------

  async startForBooking(user: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { service: true } });
    if (!booking || booking.clientId !== user.id) throw notFound('Booking');
    if (booking.status !== BookingStatus.BOOKED && booking.status !== BookingStatus.IN_PROGRESS) {
      throw conflict('This booking can no longer be paid for', 'NOT_PAYABLE');
    }
    if (booking.paymentStatus !== PaymentStatus.UNPAID) throw conflict('This booking is already paid', 'ALREADY_PAID');
    return this.start({ bookingId }, booking.priceSnapshot, `Chairtime booking: ${booking.service.name}`);
  }

  async startForOrder(user: AuthUser, orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.clientId !== user.id) throw notFound('Order');
    if (order.status === OrderStatus.CANCELED) throw conflict('This order was canceled', 'NOT_PAYABLE');
    if (order.paymentStatus !== PaymentStatus.UNPAID) throw conflict('This order is already paid', 'ALREADY_PAID');
    return this.start({ orderId }, order.totalPrice, `Chairtime order ${order.pickupCode}`);
  }

  private async start(target: PaymentTarget, amount: number, description: string) {
    // Reuse an open attempt instead of piling up intents when the client reopens checkout.
    const open = await this.prisma.payment.findFirst({
      where: { ...target, status: PaymentAttemptStatus.PENDING, provider: this.provider, amount },
      orderBy: { createdAt: 'desc' },
    });
    if (open) {
      const clientSecret = this.stripe
        ? (await this.stripe.paymentIntents.retrieve(open.stripePaymentIntentId)).client_secret
        : open.stripePaymentIntentId;
      return { paymentId: open.id, amount, ...this.publicConfig(), clientSecret };
    }

    let intentId: string;
    let clientSecret: string | null;
    if (this.stripe) {
      const intent = await this.stripe.paymentIntents.create({
        amount,
        currency: CURRENCY,
        description,
        automatic_payment_methods: { enabled: true },
        metadata: target as Record<string, string>,
      });
      intentId = intent.id;
      clientSecret = intent.client_secret;
    } else {
      intentId = `mock_pi_${randomBytes(12).toString('hex')}`;
      clientSecret = intentId;
    }
    const payment = await this.prisma.payment.create({
      data: { ...target, amount, stripePaymentIntentId: intentId, provider: this.provider },
    });
    return { paymentId: payment.id, amount, ...this.publicConfig(), clientSecret };
  }

  /** Stands in for the Stripe webhook when the mock provider is active. */
  async mockConfirm(user: AuthUser, paymentId: string, outcome: 'succeeded' | 'failed') {
    if (this.provider !== 'mock') throw badRequest('The mock provider is disabled because Stripe is configured');
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { clientId: true } }, order: { select: { clientId: true } } },
    });
    const ownerId = payment?.booking?.clientId ?? payment?.order?.clientId;
    if (!payment || payment.provider !== 'mock' || ownerId !== user.id) throw notFound('Payment');
    if (payment.status !== PaymentAttemptStatus.PENDING) throw conflict('This payment is already finished', 'PAYMENT_CLOSED');
    if (outcome === 'succeeded') await this.onSucceeded(payment.stripePaymentIntentId);
    else await this.onFailed(payment.stripePaymentIntentId, 'Card declined (test)');
    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    return { paymentId, status: fresh.status };
  }

  // ---- Provider callbacks (webhook or mock) -------------------------------------------------

  async onSucceeded(intentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { stripePaymentIntentId: intentId } });
    if (!payment || payment.status !== PaymentAttemptStatus.PENDING) return;
    const target = this.targetOf(payment);

    // The booking or order may have changed while the client was paying.
    const state = await this.targetState(target);
    const settles = state && !state.canceled && state.paymentStatus === PaymentStatus.UNPAID;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentAttemptStatus.SUCCEEDED } });
      if (settles) await this.setPaymentStatus(tx, target, PaymentStatus.PAID);
    });

    if (!settles) {
      // Paid for something that was canceled, or paid twice: give the money straight back.
      this.logger.warn(`Payment ${payment.id} arrived for a closed or already paid record; refunding it.`);
      await this.refundPayment(payment.id, intentId);
    }
  }

  async onFailed(intentId: string, reason?: string) {
    await this.prisma.payment.updateMany({
      where: { stripePaymentIntentId: intentId, status: PaymentAttemptStatus.PENDING },
      data: { status: PaymentAttemptStatus.FAILED, failureReason: reason?.slice(0, 250) },
    });
  }

  async onRefunded(intentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { stripePaymentIntentId: intentId } });
    if (!payment || payment.status !== PaymentAttemptStatus.SUCCEEDED) return;
    const target = this.targetOf(payment);
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentAttemptStatus.REFUNDED } });
      // Only the refund of the payment that settled the record moves it to REFUNDED.
      const state = await this.targetState(target, tx);
      if (state?.paymentStatus === PaymentStatus.REFUNDING) {
        await this.setPaymentStatus(tx, target, PaymentStatus.REFUNDED);
      }
    });
  }

  /** Stripe could not complete a refund: the money is still with the shop. */
  async onRefundFailed(intentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { stripePaymentIntentId: intentId } });
    if (!payment) return;
    const target = this.targetOf(payment);
    const state = await this.targetState(target);
    if (state?.paymentStatus === PaymentStatus.REFUNDING) {
      await this.setPaymentStatus(this.prisma, target, PaymentStatus.PAID);
      this.logger.error(`Refund failed for payment ${payment.id}; the record is back to PAID and needs a manual refund.`);
    }
  }

  // ---- Refunds and cleanup, called by bookings and orders -------------------------------------

  /**
   * Refunds the online payment of a booking or order.
   * `none` means it was paid in cash (no online payment exists): the refund is handed back
   * at the desk and an administrator sets REFUNDED by hand.
   */
  async refund(target: PaymentTarget): Promise<'none' | 'refunding' | 'refunded'> {
    const payment = await this.prisma.payment.findFirst({ where: { ...target, status: PaymentAttemptStatus.SUCCEEDED } });
    if (!payment) return 'none';
    await this.setPaymentStatus(this.prisma, target, PaymentStatus.REFUNDING);
    const settled = await this.refundPayment(payment.id, payment.stripePaymentIntentId);
    return settled ? 'refunded' : 'refunding';
  }

  /** Returns true when the refund is already complete (mock, or Stripe answered synchronously). */
  private async refundPayment(paymentId: string, intentId: string) {
    if (!this.stripe || intentId.startsWith('mock_')) {
      await this.onRefunded(intentId);
      return true;
    }
    const refund = await this.stripe.refunds.create({ payment_intent: intentId });
    await this.prisma.payment.update({ where: { id: paymentId }, data: { stripeRefundId: refund.id } });
    if (refund.status === 'succeeded') {
      await this.onRefunded(intentId);
      return true;
    }
    return false; // confirmed later by the `charge.refunded` webhook
  }

  /** Closes open attempts when their booking or order is canceled. */
  async cancelPending(target: PaymentTarget) {
    const open = await this.prisma.payment.findMany({ where: { ...target, status: PaymentAttemptStatus.PENDING } });
    for (const p of open) {
      await this.onFailed(p.stripePaymentIntentId, 'Canceled');
      if (this.stripe && !p.stripePaymentIntentId.startsWith('mock_')) {
        await this.stripe.paymentIntents.cancel(p.stripePaymentIntentId).catch(() => undefined);
      }
    }
  }

  /**
   * Manual change by an administrator (cash at the desk, corrections).
   * Returns the status the record should now have.
   */
  async manualChange(target: PaymentTarget, current: PaymentStatus, next: PaymentStatus): Promise<PaymentStatus> {
    const hasOnline = !!(await this.prisma.payment.findFirst({
      where: { ...target, status: PaymentAttemptStatus.SUCCEEDED },
    }));
    if (current === PaymentStatus.UNPAID && next === PaymentStatus.PAID) return PaymentStatus.PAID;
    if (current === PaymentStatus.PAID && next === PaymentStatus.UNPAID) {
      if (hasOnline) throw conflict('This was paid online. Refund it instead of marking it unpaid.', 'PAID_ONLINE');
      return PaymentStatus.UNPAID;
    }
    if (current === PaymentStatus.PAID && next === PaymentStatus.REFUNDED) {
      if (!hasOnline) return PaymentStatus.REFUNDED; // cash handed back at the desk
      return (await this.refund(target)) === 'refunded' ? PaymentStatus.REFUNDED : PaymentStatus.REFUNDING;
    }
    throw conflict(`Payment status cannot go from ${current} to ${next}`, 'INVALID_TRANSITION');
  }

  // ---- Stripe webhook -----------------------------------------------------------------------

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!this.stripe || !secret) throw notFound('Webhook');
    if (!rawBody || !signature) throw badRequest('Missing Stripe signature');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw badRequest('Invalid Stripe signature');
    }

    // Stripe retries deliveries; each event is applied once.
    try {
      await this.prisma.webhookEvent.create({ data: { id: event.id, type: event.type } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { received: true };
      throw e;
    }

    const intentOf = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : v?.id);
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onSucceeded(event.data.object.id);
        break;
      case 'payment_intent.payment_failed':
        await this.onFailed(event.data.object.id, event.data.object.last_payment_error?.message);
        break;
      case 'payment_intent.canceled':
        await this.onFailed(event.data.object.id, 'Canceled');
        break;
      case 'charge.refunded': {
        const id = intentOf(event.data.object.payment_intent);
        if (id && event.data.object.refunded) await this.onRefunded(id);
        break;
      }
      case 'refund.failed': {
        const id = intentOf(event.data.object.payment_intent);
        if (id) await this.onRefundFailed(id);
        break;
      }
      default:
        break;
    }
    return { received: true };
  }

  // ---- Helpers ------------------------------------------------------------------------------

  private targetOf(payment: { bookingId: string | null; orderId: string | null }): PaymentTarget {
    return payment.bookingId ? { bookingId: payment.bookingId } : { orderId: payment.orderId! };
  }

  private async targetState(target: PaymentTarget, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    if ('bookingId' in target) {
      const b = await db.booking.findUnique({ where: { id: target.bookingId } });
      return b && { paymentStatus: b.paymentStatus, canceled: b.status === BookingStatus.CANCELED };
    }
    const o = await db.order.findUnique({ where: { id: target.orderId } });
    return o && { paymentStatus: o.paymentStatus, canceled: o.status === OrderStatus.CANCELED };
  }

  private async setPaymentStatus(
    db: Prisma.TransactionClient | PrismaService,
    target: PaymentTarget,
    paymentStatus: PaymentStatus,
  ) {
    if ('bookingId' in target) await db.booking.update({ where: { id: target.bookingId }, data: { paymentStatus } });
    else await db.order.update({ where: { id: target.orderId }, data: { paymentStatus } });
  }
}
