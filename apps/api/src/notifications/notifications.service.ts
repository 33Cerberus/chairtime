import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/**
 * Outgoing messages. The transport is the console: every message is logged, and
 * non-secret ones are also stored in `Notification` so they show up in the client's
 * account. Swap `deliver` for an SMS or e-mail gateway when one is chosen.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notify');

  constructor(private readonly prisma: PrismaService) {}

  /** Sends a message that must not be stored, e.g. a one-time code. */
  async sendSecret(phoneNumber: string, text: string) {
    await this.deliver(phoneNumber, text);
  }

  /** Sends a message and keeps it in the user's notification history. */
  async notify(userId: string, type: string, body: string, bookingId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    await this.prisma.notification.create({ data: { userId, type, body, bookingId, channel: 'sms' } });
    await this.deliver(user.phoneNumber, body);
  }

  private async deliver(phoneNumber: string, text: string) {
    this.logger.log(`SMS to ${phoneNumber}: ${text}`);
  }
}

@Global()
@Module({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
