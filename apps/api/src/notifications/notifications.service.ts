import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { runtime, smsConfigured } from '../common/runtime';

/**
 * Outgoing text messages.
 *
 * - With Twilio configured, messages are sent by SMS.
 * - In development they are printed to the log, so every flow can be tried without a gateway.
 * - In production without a gateway nothing is printed: a log is not a safe place for one-time
 *   codes or for clients' phone numbers. Ordinary messages are still kept in the client's
 *   message history; flows that need a code are refused (see `canSendSecrets`).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notify');
  private warned = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Whether a one-time code can actually reach a phone (or, in development, the log). */
  get canSendSecrets() {
    return smsConfigured() || runtime.consoleMessages;
  }

  /** Sends a message that must not be stored, e.g. a one-time code. */
  async sendSecret(phoneNumber: string, text: string) {
    await this.deliver(phoneNumber, text);
  }

  /**
   * Sends a message and keeps it in the user's notification history.
   * A delivery failure is logged, never thrown: a booking must not fail because a text did.
   */
  async notify(userId: string, type: string, body: string, bookingId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const channel = smsConfigured() ? 'sms' : runtime.consoleMessages ? 'log' : 'in-app';
    await this.prisma.notification.create({ data: { userId, type, body, bookingId, channel } });
    try {
      await this.deliver(user.phoneNumber, body);
    } catch (e) {
      this.logger.error(`Could not deliver a ${type} message: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async deliver(phoneNumber: string, text: string) {
    if (smsConfigured()) return this.sendViaTwilio(phoneNumber, text);
    if (runtime.consoleMessages) {
      this.logger.log(`SMS to ${phoneNumber}: ${text}`);
      return;
    }
    if (!this.warned) {
      this.warned = true;
      this.logger.warn('No SMS gateway is configured; text messages are not being sent.');
    }
  }

  /** Twilio's REST API, called directly so no SDK is needed. */
  private async sendViaTwilio(to: string, body: string) {
    const { accountSid, authToken, from } = runtime.twilio;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      // `from` is a phone number, or a Messaging Service SID starting with "MG".
      body: new URLSearchParams({ To: to, Body: body, ...(from.startsWith('MG') ? { MessagingServiceSid: from } : { From: from }) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(`Twilio answered ${res.status}${detail?.message ? `: ${detail.message}` : ''}`);
    }
  }
}

@Global()
@Module({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
