import { BookingStatus, PaymentStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQuery } from '../common/pagination';

export class CreateBookingDto {
  @IsUUID()
  barberId: string;

  @IsUUID()
  serviceId: string;

  @IsISO8601({ strict: true }, { message: 'startAt must be an ISO 8601 moment, e.g. 2026-10-01T14:30:00Z' })
  startAt: string;

  /** Administrators pass the client the booking is for. Ignored for clients. */
  @IsOptional() @IsUUID()
  clientId?: string;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

export class MoveBookingDto {
  @IsISO8601({ strict: true }, { message: 'startAt must be an ISO 8601 moment, e.g. 2026-10-01T14:30:00Z' })
  startAt: string;
}

export class CancelBookingDto {
  @IsOptional() @IsString() @MaxLength(300)
  reason?: string;

  /**
   * Administrators only. Whether a paid booking is refunded. Defaults to the client rule:
   * refunded when canceled at least 2 hours before the start.
   */
  @IsOptional() @IsBoolean()
  refund?: boolean;
}

export class BookingStatusDto {
  @IsIn([BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED, BookingStatus.NO_SHOW], {
    message: 'status must be IN_PROGRESS, COMPLETED or NO_SHOW. Use /cancel to cancel.',
  })
  status: BookingStatus;
}

export class PaymentStatusDto {
  @IsIn([PaymentStatus.PAID, PaymentStatus.UNPAID, PaymentStatus.REFUNDED], {
    message: 'paymentStatus must be PAID, UNPAID or REFUNDED',
  })
  paymentStatus: PaymentStatus;
}

export class BookingsQuery extends PageQuery {
  @IsOptional() @IsISO8601()
  from?: string;

  @IsOptional() @IsISO8601()
  to?: string;

  /** One status, or several separated by commas. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsEnum(BookingStatus, { each: true })
  status?: BookingStatus[];

  @IsOptional() @IsUUID()
  barberId?: string;

  /** Administrators only. */
  @IsOptional() @IsUUID()
  clientId?: string;

  @IsOptional() @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
