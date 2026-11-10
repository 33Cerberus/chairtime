import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BookingStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma.service';
import { endOfLocalDay, SHOP_TZ, startOfLocalDay } from '../common/time';
import { NotificationsService } from './notifications.service';

/** Reminders go out the day before the visit, during civil hours. */
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 21;

@Injectable()
export class RemindersJob {
  private readonly logger = new Logger('Reminders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/10 * * * *')
  async run() {
    const now = DateTime.now().setZone(SHOP_TZ);
    if (now.hour < SEND_FROM_HOUR || now.hour >= SEND_UNTIL_HOUR) return;
    const sent = await this.sendFor(now.plus({ days: 1 }).toISODate()!);
    if (sent) this.logger.log(`Sent ${sent} reminder${sent > 1 ? 's' : ''}`);
  }

  /** Sends a reminder for every booked visit on `date` (local) that has not had one yet. */
  async sendFor(date: string) {
    const due = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.BOOKED,
        reminderSentAt: null,
        startAt: { gte: startOfLocalDay(date), lt: endOfLocalDay(date) },
      },
      include: { service: true, barber: { include: { user: true } } },
    });
    let sent = 0;
    for (const b of due) {
      // Claim the booking first, so a second instance of the job cannot send a duplicate.
      const claimed = await this.prisma.booking.updateMany({
        where: { id: b.id, reminderSentAt: null, status: BookingStatus.BOOKED },
        data: { reminderSentAt: new Date() },
      });
      if (claimed.count !== 1) continue;
      const time = DateTime.fromJSDate(b.startAt, { zone: SHOP_TZ }).toFormat('HH:mm');
      await this.notifications.notify(
        b.clientId,
        'BOOKING_REMINDER',
        `Reminder: ${b.service.name} with ${b.barber.user.firstName} tomorrow at ${time}. Need to change it? You can until 2 hours before.`,
        b.id,
      );
      sent += 1;
    }
    return sent;
  }
}
