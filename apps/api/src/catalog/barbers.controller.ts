import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import { ADMINS, AuthUser, CurrentUser, isAdmin, Public, Roles } from '../common/auth-user';
import { conflict, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { MAX_UPLOAD_BYTES, StorageService, UploadedImage } from '../storage/storage.service';
import { AssignServiceDto, UpdateBarberDto, UpdatePriceDto } from './catalog.dto';

const INCLUDE = {
  user: { select: { firstName: true, lastName: true, isActive: true, role: true } },
  services: { include: { service: true }, orderBy: { service: { name: 'asc' } } },
} satisfies Prisma.BarberProfileInclude;

type BarberRow = Prisma.BarberProfileGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class BarbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Public profile: name, photo, description, services and prices. Never contact details. */
  private view(b: BarberRow, includeInactiveServices = false) {
    return {
      id: b.id,
      firstName: b.user.firstName,
      lastName: b.user.lastName,
      title: b.title,
      bio: b.bio,
      photoUrl: b.photoUrl,
      isActive: b.user.isActive && b.user.role === Role.BARBER,
      services: b.services
        .filter((s) => includeInactiveServices || s.service.isActive)
        .map((s) => ({
          serviceId: s.serviceId,
          name: s.service.name,
          description: s.service.description,
          duration: s.service.duration,
          isActive: s.service.isActive,
          price: s.price,
        })),
    };
  }

  async list() {
    const barbers = await this.prisma.barberProfile.findMany({
      where: { user: { isActive: true, role: Role.BARBER } },
      include: INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return barbers.map((b) => this.view(b));
  }

  async get(id: string, user?: AuthUser) {
    const b = await this.prisma.barberProfile.findUnique({ where: { id }, include: INCLUDE });
    const staffView = isAdmin(user) || (!!user?.barberId && user.barberId === id);
    const live = b && b.user.isActive && b.user.role === Role.BARBER;
    if (!b || (!live && !staffView)) throw notFound('Barber');
    return this.view(b, staffView);
  }

  /** "Barber own, Admin". */
  private async assertCanEdit(user: AuthUser, id: string) {
    const profile = await this.prisma.barberProfile.findUnique({ where: { id } });
    if (!profile || !(isAdmin(user) || user.barberId === id)) throw notFound('Barber');
  }

  async update(user: AuthUser, id: string, dto: UpdateBarberDto) {
    await this.assertCanEdit(user, id);
    // A photo URL can only be cleared here; setting one goes through the upload endpoint.
    const { photoUrl, ...rest } = dto;
    await this.prisma.barberProfile.update({
      where: { id },
      data: { ...rest, ...(photoUrl === null ? { photoUrl: null } : {}) },
    });
    return this.get(id, user);
  }

  async uploadPhoto(user: AuthUser, id: string, file: UploadedImage | undefined) {
    await this.assertCanEdit(user, id);
    const photoUrl = await this.storage.saveImage(file, 'barbers');
    await this.prisma.barberProfile.update({ where: { id }, data: { photoUrl } });
    return this.get(id, user);
  }

  // ---- Services and prices of a barber --------------------------------------------------------

  private async assertBarber(id: string) {
    if (!(await this.prisma.barberProfile.findUnique({ where: { id } }))) throw notFound('Barber');
  }

  async assignService(id: string, dto: AssignServiceDto) {
    await this.assertBarber(id);
    if (!(await this.prisma.service.findUnique({ where: { id: dto.serviceId } }))) throw notFound('Service');
    const existing = await this.prisma.barberService.findUnique({
      where: { barberId_serviceId: { barberId: id, serviceId: dto.serviceId } },
    });
    if (existing) throw conflict('This barber already offers this service', 'ALREADY_ASSIGNED');
    await this.prisma.barberService.create({ data: { barberId: id, serviceId: dto.serviceId, price: dto.price } });
    return this.get(id, { id: '', role: Role.ADMIN, barberId: null });
  }

  /** Existing bookings keep their `priceSnapshot`. */
  async updatePrice(id: string, serviceId: string, dto: UpdatePriceDto) {
    const key = { barberId_serviceId: { barberId: id, serviceId } };
    if (!(await this.prisma.barberService.findUnique({ where: key }))) throw notFound('Barber service');
    await this.prisma.barberService.update({ where: key, data: { price: dto.price } });
    return this.get(id, { id: '', role: Role.ADMIN, barberId: null });
  }

  /** Physical delete: bookings reference the service and the barber directly. */
  async removeService(id: string, serviceId: string) {
    const key = { barberId_serviceId: { barberId: id, serviceId } };
    if (!(await this.prisma.barberService.findUnique({ where: key }))) throw notFound('Barber service');
    await this.prisma.barberService.delete({ where: key });
  }
}

const STAFF = [Role.BARBER, ...ADMINS];

@ApiTags('Barbers')
@ApiBearerAuth()
@Controller('barbers')
export class BarbersController {
  constructor(private readonly barbers: BarbersService) {}

  @Public() @Get()
  @ApiOperation({ summary: 'Active barbers with their services and prices. Public fields only' })
  list() {
    return this.barbers.list();
  }

  @Public() @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.barbers.get(id, user);
  }

  @Roles(...STAFF) @Patch(':id')
  @ApiOperation({ summary: 'Edit the public profile: title, bio, or clear the photo' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBarberDto) {
    return this.barbers.update(user, id, dto);
  }

  @Roles(...STAFF) @Post(':id/photo')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload the profile photo (field `file`; JPEG, PNG, WebP or AVIF, up to 5 MB)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.barbers.uploadPhoto(user, id, file);
  }

  @Roles(...ADMINS) @Post(':id/services')
  assignService(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignServiceDto) {
    return this.barbers.assignService(id, dto);
  }

  @Roles(...ADMINS) @Patch(':id/services/:serviceId')
  updatePrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: UpdatePriceDto,
  ) {
    return this.barbers.updatePrice(id, serviceId, dto);
  }

  @Roles(...ADMINS) @Delete(':id/services/:serviceId') @HttpCode(204)
  async removeService(@Param('id', ParseUUIDPipe) id: string, @Param('serviceId', ParseUUIDPipe) serviceId: string) {
    await this.barbers.removeService(id, serviceId);
  }
}
