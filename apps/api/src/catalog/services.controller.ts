import { Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ADMINS, AuthUser, CurrentUser, isAdmin, Public, Roles } from '../common/auth-user';
import { badRequest, conflict, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { SLOT_STEP_MIN } from '../common/time';
import { CreateServiceDto, UpdateServiceDto } from './catalog.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Clients see active services with the lowest price across barbers ("from X").
   * Administrators see every service, including deactivated ones.
   */
  async list(user?: AuthUser) {
    const admin = isAdmin(user);
    const services = await this.prisma.service.findMany({
      where: admin ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        barbers: {
          where: { barber: { user: { isActive: true, role: Role.BARBER } } },
          select: { barberId: true, price: true },
        },
      },
    });
    return services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      duration: s.duration,
      isActive: s.isActive,
      /** Lowest price across the barbers who offer it; null when nobody does yet. */
      priceFrom: s.barbers.length ? Math.min(...s.barbers.map((b) => b.price)) : null,
      priceTo: s.barbers.length ? Math.max(...s.barbers.map((b) => b.price)) : null,
      barberIds: s.barbers.map((b) => b.barberId),
    }));
  }

  private assertDuration(duration?: number) {
    if (duration !== undefined && duration % SLOT_STEP_MIN !== 0) {
      throw badRequest('Duration must be a multiple of 15 minutes');
    }
  }

  private async assertNameFree(name: string | undefined, exceptId?: string) {
    if (!name) return;
    const clash = await this.prisma.service.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (clash) throw conflict('A service with this name already exists', 'NAME_TAKEN');
  }

  async create(dto: CreateServiceDto) {
    this.assertDuration(dto.duration);
    await this.assertNameFree(dto.name);
    return this.prisma.service.create({ data: dto });
  }

  /** Existing bookings keep their own duration snapshot, so editing a service never moves them. */
  async update(id: string, dto: UpdateServiceDto) {
    if (!(await this.prisma.service.findUnique({ where: { id } }))) throw notFound('Service');
    this.assertDuration(dto.duration);
    await this.assertNameFree(dto.name, id);
    return this.prisma.service.update({ where: { id }, data: dto });
  }
}

@ApiTags('Services')
@ApiBearerAuth()
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Public() @Get()
  @ApiOperation({ summary: 'Service catalog with "from" prices. Administrators also see deactivated services' })
  list(@CurrentUser() user?: AuthUser) {
    return this.services.list(user);
  }

  @Roles(...ADMINS) @Post()
  create(@Body() dto: CreateServiceDto) {
    return this.services.create(dto);
  }

  @Roles(...ADMINS) @Patch(':id')
  @ApiOperation({ summary: 'Edit or deactivate (isActive: false). Services are never deleted' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto) {
    return this.services.update(id, dto);
  }
}
