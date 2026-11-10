import { DayOfWeek, ExceptionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { HHMM, ISO_DATE } from '../common/time';

const QUARTER = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const quarterMessage = 'Times use HH:mm on a 15-minute step, e.g. 10:00 or 14:45';

export class IntervalDto {
  @Matches(QUARTER, { message: quarterMessage })
  startTime: string;

  @Matches(QUARTER, { message: quarterMessage })
  endTime: string;
}

export class WeekIntervalDto extends IntervalDto {
  @IsEnum(DayOfWeek)
  dayOfWeek: DayOfWeek;
}

export class ReplaceWeekDto {
  @IsArray() @ArrayMaxSize(42) @ValidateNested({ each: true }) @Type(() => WeekIntervalDto)
  intervals: WeekIntervalDto[];
}

export class ReplaceDayDto {
  @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => IntervalDto)
  intervals: IntervalDto[];
}

export class CreateExceptionDto {
  @Matches(ISO_DATE, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @IsEnum(ExceptionType)
  type: ExceptionType;

  @IsOptional() @Matches(QUARTER, { message: quarterMessage })
  startTime?: string;

  @IsOptional() @Matches(QUARTER, { message: quarterMessage })
  endTime?: string;

  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}

export class RangeQuery {
  @IsOptional() @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional() @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class SlotsQuery {
  @IsUUID()
  serviceId: string;

  @Matches(ISO_DATE, { message: 'date must be YYYY-MM-DD' })
  date: string;

  /** When moving a booking, its own time must count as free. */
  @IsOptional() @IsUUID()
  excludeBookingId?: string;
}

export class SlotCalendarQuery {
  @IsUUID()
  serviceId: string;

  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from: string;

  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to: string;

  @IsOptional() @IsUUID()
  excludeBookingId?: string;
}

export { HHMM };
