import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ADMINS, AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { PrismaService } from '../common/prisma.service';
import { ChangeRoleDto, CreateClientDto, CreateStaffDto, UpdateMeDto, UpdateUserDto, UsersQuery } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.get(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Name, e-mail, phone, password. A new password needs currentPassword' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.id, dto);
  }

  @Roles(Role.CLIENT) @Post('me/deactivate') @HttpCode(200)
  @ApiOperation({ summary: 'Close the own account. Upcoming bookings and open orders are canceled' })
  deactivateMe(@CurrentUser() user: AuthUser) {
    return this.users.deactivate(user, user.id);
  }

  @Get('me/notifications')
  @ApiOperation({ summary: 'Messages the shop sent to this account' })
  notifications(@CurrentUser() user: AuthUser) {
    return this.prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, type: true, body: true, createdAt: true, bookingId: true },
    });
  }

  @Roles(...ADMINS) @Get()
  @ApiOperation({ summary: 'Filters: role, isActive, search by name or phone. Paginated' })
  list(@Query() q: UsersQuery) {
    return this.users.list(q);
  }

  @Roles(...ADMINS) @Post('clients')
  @ApiOperation({ summary: 'Client record with a name and phone only, no password' })
  createClient(@Body() dto: CreateClientDto) {
    return this.users.createClient(dto);
  }

  @Roles(Role.OWNER) @Post('staff')
  @ApiOperation({ summary: 'Create a barber or administrator. Returns a single-use link to set the password' })
  createStaff(@Body() dto: CreateStaffDto) {
    return this.users.createStaff(dto);
  }

  @Roles(...ADMINS) @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Roles(...ADMINS) @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(user, id, dto);
  }

  @Roles(Role.OWNER) @Patch(':id/role')
  changeRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeRoleDto) {
    return this.users.changeRole(id, dto);
  }

  @Roles(...ADMINS) @Post(':id/password-link') @HttpCode(200)
  @ApiOperation({ summary: 'Issue a new single-use link for setting a password' })
  passwordLink(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.passwordLink(user, id);
  }

  @Roles(...ADMINS) @Post(':id/deactivate') @HttpCode(200)
  @ApiOperation({ summary: 'Administrators — only by the owner. A barber with upcoming bookings — 409' })
  deactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.deactivate(user, id);
  }

  @Roles(...ADMINS) @Post(':id/activate') @HttpCode(200)
  activate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.activate(user, id);
  }
}
