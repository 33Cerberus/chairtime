import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { SHOP_TZ } from '../common/time';
import { PaymentsService } from '../payments/payments.service';

const DAY = 86_400_000;
/** How long the trail of staff actions and sent messages is kept. */
const HISTORY_DAYS = 400;

/**
 * Nightly housekeeping. Keeps short-lived security records from piling up, closes checkouts
 * that were opened and abandoned, and applies the retention period to logs that hold
 * personal data.
 */
@Injectable()
export class MaintenanceJob {
  private readonly logger = new Logger('Maintenance');

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  @Cron('17 3 * * *', { timeZone: SHOP_TZ })
  async run() {
    const now = Date.now();
    const ago = (days: number) => new Date(now - days * DAY);
    try {
      const [sessions, tokens, events, throttles, audit, messages] = await Promise.all([
        // Kept a week past expiry, so reuse of a recently rotated token is still recognised.
        this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: ago(7) } } }),
        this.prisma.oneTimeToken.deleteMany({ where: { OR: [{ expiresAt: { lt: ago(1) } }, { usedAt: { lt: ago(1) } }] } }),
        this.prisma.webhookEvent.deleteMany({ where: { createdAt: { lt: ago(60) } } }),
        this.prisma.loginThrottle.deleteMany({ where: { updatedAt: { lt: ago(1) } } }),
        this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: ago(HISTORY_DAYS) } } }),
        this.prisma.notification.deleteMany({ where: { createdAt: { lt: ago(HISTORY_DAYS) } } }),
      ]);
      const abandoned = await this.payments.expireAbandoned(ago(1));
      this.logger.log(
        `Removed ${sessions.count} expired sessions, ${tokens.count} one-time tokens, ${events.count} webhook records, ` +
          `${throttles.count} sign-in counters, ${audit.count} audit entries and ${messages.count} messages; ` +
          `closed ${abandoned} abandoned payments.`,
      );
    } catch (e) {
      this.logger.error(`Housekeeping failed: ${e instanceof Error ? e.stack : e}`);
    }
  }
}
