import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { ADMINS, AuthUser, CurrentUser, isAdmin, Public, Roles } from '../common/auth-user';
import { badRequest, conflict, notFound } from '../common/errors';
import { paging } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { MAX_UPLOAD_BYTES, StorageService, UploadedImage } from '../storage/storage.service';
import { CreateProductDto, ProductsQuery, UpdateProductDto } from './catalog.dto';

const MAX_PHOTOS = 8;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(q: ProductsQuery, user?: AuthUser) {
    const showInactive = isAdmin(user) && q.includeInactive !== false;
    const where: Prisma.ProductWhereInput = {
      ...(showInactive ? {} : { isActive: true }),
      ...(q.category ? { category: q.category } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [items, total, categories] = await Promise.all([
      this.prisma.product.findMany({ where, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], ...paging(q) }),
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where: { isActive: true, category: { not: null } },
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
    ]);
    return { items, total, categories: categories.map((c) => c.category as string) };
  }

  async get(id: string, user?: AuthUser) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || (!product.isActive && !isAdmin(user))) throw notFound('Product');
    return product;
  }

  private async assertNameFree(name: string | undefined, exceptId?: string) {
    if (!name) return;
    const clash = await this.prisma.product.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (clash) throw conflict('A product with this name already exists', 'NAME_TAKEN');
  }

  async create(dto: CreateProductDto) {
    await this.assertNameFree(dto.name);
    return this.prisma.product.create({ data: dto });
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw notFound('Product');
    await this.assertNameFree(dto.name, id);
    if (dto.photoUrls && dto.photoUrls.some((u) => !product.photoUrls.includes(u))) {
      throw badRequest('photoUrls may only reorder or remove existing photos. Upload new ones with POST /products/:id/photos');
    }
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async addPhoto(id: string, file: UploadedImage | undefined) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw notFound('Product');
    if (product.photoUrls.length >= MAX_PHOTOS) throw conflict(`A product can have up to ${MAX_PHOTOS} photos`, 'TOO_MANY_PHOTOS');
    const url = await this.storage.saveImage(file, 'products');
    return this.prisma.product.update({ where: { id }, data: { photoUrls: { push: url } } });
  }
}

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Public() @Get()
  @ApiOperation({ summary: 'Product catalog. Administrators also see deactivated products. Paginated' })
  list(@Query() q: ProductsQuery, @CurrentUser() user?: AuthUser) {
    return this.products.list(q, user);
  }

  @Public() @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.products.get(id, user);
  }

  @Roles(...ADMINS) @Post()
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Roles(...ADMINS) @Patch(':id')
  @ApiOperation({ summary: 'Edit, restock, reorder photos, or deactivate (isActive: false)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Roles(...ADMINS) @Post(':id/photos')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Add a photo (field `file`). The first photo is the one shown in the catalog' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  addPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.products.addPhoto(id, file);
  }
}
