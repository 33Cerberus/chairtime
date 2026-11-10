import { Body, Controller, Delete, Get, Injectable, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { CartItemDto } from '../catalog/catalog.dto';
import { conflict, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /** One cart per user, shared between web and mobile. Created on first use. */
  async get(userId: string) {
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: { items: { include: { product: true }, orderBy: { createdAt: 'asc' } } },
    });
    const items = cart.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      name: i.product.name,
      price: i.product.price,
      photoUrl: i.product.photoUrls[0] ?? null,
      stock: i.product.stock,
      /** False when the product was deactivated or there is not enough stock for this quantity. */
      available: i.product.isActive && i.product.stock >= i.quantity,
      lineTotal: i.product.price * i.quantity,
    }));
    return {
      items,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      total: items.reduce((n, i) => n + i.lineTotal, 0),
      canCheckout: items.length > 0 && items.every((i) => i.available),
    };
  }

  async setItem(userId: string, productId: string, quantity: number) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) throw notFound('Product');
    if (product.stock < quantity) {
      throw conflict(
        product.stock === 0 ? `${product.name} is sold out` : `Only ${product.stock} of ${product.name} left`,
        'OUT_OF_STOCK',
        { productId, stock: product.stock },
      );
    }
    const cart = await this.prisma.cart.upsert({ where: { userId }, create: { userId }, update: {} });
    await this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      create: { cartId: cart.id, productId, quantity },
      update: { quantity },
    });
    return this.get(userId);
  }

  async removeItem(userId: string, productId: string) {
    await this.prisma.cartItem.deleteMany({ where: { productId, cart: { userId } } });
    return this.get(userId);
  }

  async clear(userId: string) {
    await this.prisma.cartItem.deleteMany({ where: { cart: { userId } } });
    return this.get(userId);
  }
}

@ApiTags('Cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.cart.get(user.id);
  }

  @Put('items/:productId')
  @ApiOperation({ summary: 'Set the quantity; adds the item if it is not in the cart' })
  setItem(@CurrentUser() user: AuthUser, @Param('productId', ParseUUIDPipe) productId: string, @Body() dto: CartItemDto) {
    return this.cart.setItem(user.id, productId, dto.quantity);
  }

  @Delete('items/:productId')
  removeItem(@CurrentUser() user: AuthUser, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.cart.removeItem(user.id, productId);
  }

  @Delete()
  @ApiOperation({ summary: 'Empty the cart' })
  clear(@CurrentUser() user: AuthUser) {
    return this.cart.clear(user.id);
  }
}
