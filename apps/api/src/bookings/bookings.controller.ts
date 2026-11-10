import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ADMINS, AuthUser, CurrentUser, Roles } from '../common/auth-user';
import {
  BookingsQuery,
  BookingStatusDto,
  CancelBookingDto,
  CreateBookingDto,
  MoveBookingDto,
  PaymentStatusDto,
} from './bookings.dto';
import { BookingsService } from './bookings.service';

@ApiTags('Bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Roles(Role.CLIENT, ...ADMINS) @Post()
  @ApiOperation({ summary: 'Book a slot. The server computes endAt and the price and duration snapshots' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Own bookings for clients and barbers, all bookings for administrators' })
  list(@CurrentUser() user: AuthUser, @Query() q: BookingsQuery) {
    return this.bookings.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(user, id);
  }

  @Roles(Role.CLIENT, ...ADMINS) @Patch(':id')
  @ApiOperation({ summary: 'Move: only startAt changes. Clients — at least 2 hours before the start' })
  move(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveBookingDto) {
    return this.bookings.move(user, id, dto.startAt);
  }

  @Roles(Role.CLIENT, ...ADMINS) @Post(':id/cancel') @HttpCode(200)
  @ApiOperation({ summary: 'Cancel. Clients — at least 2 hours before the start. Refunds a paid booking when due' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelBookingDto) {
    return this.bookings.cancel(user, id, dto);
  }

  @Roles(Role.BARBER, ...ADMINS) @Patch(':id/status')
  @ApiOperation({ summary: 'IN_PROGRESS, COMPLETED or NO_SHOW. Terminal statuses never change' })
  setStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BookingStatusDto) {
    return this.bookings.setStatus(user, id, dto.status);
  }

  @Roles(...ADMINS) @Patch(':id/payment-status')
  @ApiOperation({ summary: 'Manual change, e.g. cash taken or handed back at the desk' })
  setPaymentStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentStatusDto) {
    return this.bookings.setPaymentStatus(user, id, dto.paymentStatus);
  }
}
