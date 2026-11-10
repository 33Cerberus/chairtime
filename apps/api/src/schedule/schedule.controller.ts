import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth-user';
import {
  CreateExceptionDto,
  RangeQuery,
  ReplaceDayDto,
  ReplaceWeekDto,
  SlotCalendarQuery,
  SlotsQuery,
} from './schedule.dto';
import { ScheduleService } from './schedule.service';

const STAFF = [Role.BARBER, Role.ADMIN, Role.OWNER];

@ApiTags('Schedule')
@ApiBearerAuth()
@Controller('barbers/:id')
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Roles(...STAFF) @Get('working-hours')
  async getWorkingHours(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.schedule.assertAccess(user, id);
    return this.schedule.getWorkingHours(id);
  }

  @Roles(...STAFF) @Put('working-hours')
  @ApiOperation({ summary: 'Replace the whole week. 409 if upcoming bookings would fall outside the new hours' })
  async replaceWeek(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceWeekDto) {
    await this.schedule.assertAccess(user, id);
    return this.schedule.replaceWeek(id, dto.intervals);
  }

  @Roles(...STAFF) @Put('working-hours/:dayOfWeek')
  @ApiOperation({ summary: 'Replace one day. An empty list is a day off' })
  async replaceDay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayOfWeek') dayOfWeek: string,
    @Body() dto: ReplaceDayDto,
  ) {
    await this.schedule.assertAccess(user, id);
    return this.schedule.replaceDay(id, dayOfWeek, dto.intervals);
  }

  @Roles(...STAFF) @Get('exceptions')
  async listExceptions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: RangeQuery) {
    await this.schedule.assertAccess(user, id);
    return this.schedule.listExceptions(id, q);
  }

  @Roles(...STAFF) @Post('exceptions')
  async createException(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExceptionDto,
  ) {
    await this.schedule.assertAccess(user, id);
    return this.schedule.createException(id, dto);
  }

  @Roles(...STAFF) @Delete('exceptions/:exceptionId') @HttpCode(204)
  @ApiOperation({ summary: '409 when removing extra hours that already have bookings' })
  async deleteException(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
  ) {
    await this.schedule.assertAccess(user, id);
    await this.schedule.deleteException(id, exceptionId);
  }

  @Roles(...STAFF) @Get('schedule')
  @ApiOperation({ summary: 'Resolved working hours per date: weekly hours with exceptions applied' })
  async resolved(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: RangeQuery) {
    await this.schedule.assertAccess(user, id);
    return this.schedule.resolvedSchedule(id, q);
  }

  @Public() @Get('slots')
  @ApiOperation({ summary: 'Bookable start times of one service on one date' })
  slots(@Param('id', ParseUUIDPipe) id: string, @Query() q: SlotsQuery) {
    return this.schedule.slots(id, q);
  }

  @Public() @Get('slots/calendar')
  @ApiOperation({ summary: 'Number of bookable slots per day over a date range' })
  slotCalendar(@Param('id', ParseUUIDPipe) id: string, @Query() q: SlotCalendarQuery) {
    return this.schedule.slotCalendar(id, q);
  }
}
