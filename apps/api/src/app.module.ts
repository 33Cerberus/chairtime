import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard, RolesGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BookingsController } from './bookings/bookings.controller';
import { BookingsService } from './bookings/bookings.service';
import { BarbersController, BarbersService } from './catalog/barbers.controller';
import { ProductsController, ProductsService } from './catalog/products.controller';
import { ServicesController, ServicesService } from './catalog/services.controller';
import { Public } from './common/auth-user';
import { PrismaModule, PrismaService } from './common/prisma.service';
import { SHOP_TZ } from './common/time';
import { NotificationsModule } from './notifications/notifications.service';
import { RemindersJob } from './notifications/reminders.job';
import { CartController, CartService } from './orders/cart.controller';
import { OrdersController, OrdersService } from './orders/orders.controller';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { ReportsController, ReportsService } from './reports/reports.controller';
import { AvailabilityService } from './schedule/availability.service';
import { ScheduleController } from './schedule/schedule.controller';
import { ScheduleService } from './schedule/schedule.service';
import { StorageModule } from './storage/storage.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@ApiTags('Health')
@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public() @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', timezone: SHOP_TZ, time: new Date() };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    NotificationsModule,
    StorageModule,
    AuthModule,
  ],
  controllers: [
    HealthController,
    UsersController,
    // ScheduleController declares /barbers/:id/slots/calendar etc.; BarbersController comes after it.
    ScheduleController,
    BarbersController,
    ServicesController,
    BookingsController,
    ProductsController,
    CartController,
    OrdersController,
    PaymentsController,
    ReportsController,
  ],
  providers: [
    // Order matters: rate limit, then identify the caller, then check the role.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    AvailabilityService,
    ScheduleService,
    PaymentsService,
    BookingsService,
    BarbersService,
    ServicesService,
    ProductsService,
    CartService,
    OrdersService,
    UsersService,
    ReportsService,
    RemindersJob,
  ],
})
export class AppModule {}
