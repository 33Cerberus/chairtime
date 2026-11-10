import { Body, Controller, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { randomInt } from 'crypto';
import { PaymentStatusDto } from '../bookings/bookings.dto';
import { ADMINS, AuthUser, CurrentUser, isAdmin, Roles } from '../common/auth-user';
import { badRequest, conflict, notFound } from '../common/errors';
import { PageQuery, paging } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';

class OrderItemDto {
  @IsUUID()
  productId: string;

  @IsInt() @Min(1) @Max(99)
  quantity: number;
}

class CreateOrderDto {
  /** Administrators only: place the order for this client, with the items below. */
  @IsOptional() @IsUUID()
  clientId?: string;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items?: OrderItemDto[];
}

class OrderStatusDto {
  @IsIn([OrderStatus.IN_PROGRESS, OrderStatus.READY, OrderStatus.RECEIVED], {
    message: 'status must be IN_PROGRESS, READY or RECEIVED. Use /cancel to cancel.',
  })
  status: OrderStatus;
}

class OrdersQuery extends PageQuery {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsEnum(OrderStatus, { each: true })
  status?: OrderStatus[];

  /** Administrators only. */
  @IsOptional() @IsUUID()
  clientId?: string;
}

const INCLUDE = {
  items: { include: { product: { select: { name: true, photoUrls: true } } }, orderBy: { createdAt: 'asc' } },
  client: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof INCLUDE }>;

const NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  CREATED: OrderStatus.IN_PROGRESS,
  IN_PROGRESS: OrderStatus.READY,
  READY: OrderStatus.RECEIVED,
};
const TERMINAL: OrderStatus[] = [OrderStatus.RECEIVED, OrderStatus.CANCELED];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  private view(o: OrderRow, viewer: AuthUser) {
    const admin = isAdmin(viewer);
    const open = !TERMINAL.includes(o.status);
    return {
      id: o.id,
      pickupCode: o.pickupCode,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalPrice: o.totalPrice,
      createdAt: o.createdAt,
      canceledAt: o.canceledAt,
      client: o.client,
      items: o.items.map((i) => ({
        productId: i.productId,
        name: i.product.name,
        photoUrl: i.product.photoUrls[0] ?? null,
        quantity: i.quantity,
        priceSnapshot: i.priceSnapshot,
        lineTotal: i.priceSnapshot * i.quantity,
      })),
      actions: {
        cancel: open && (admin || o.clientId === viewer.id),
        pay: o.clientId === viewer.id && o.status !== OrderStatus.CANCELED && o.paymentStatus === PaymentStatus.UNPAID,
        advanceTo: admin ? (NEXT[o.status] ?? null) : null,
        markPaid: admin && o.paymentStatus === PaymentStatus.UNPAID && o.status !== OrderStatus.CANCELED,
        refund: admin && o.paymentStatus === PaymentStatus.PAID,
      },
    };
  }

  private async visible(user: AuthUser, id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: INCLUDE });
    if (!o || !(isAdmin(user) || o.clientId === user.id)) throw notFound('Order');
    return o;
  }

  async list(user: AuthUser, q: OrdersQuery) {
    const where: Prisma.OrderWhereInput = {
      ...(isAdmin(user) ? (q.clientId ? { clientId: q.clientId } : {}) : { clientId: user.id }),
      ...(q.status?.length ? { status: { in: q.status } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({ where, include: INCLUDE, orderBy: { createdAt: 'desc' }, ...paging(q) }),
      this.prisma.order.count({ where }),
    ]);
    return { items: items.map((o) => this.view(o, user)), total };
  }

  async get(user: AuthUser, id: string) {
    return this.view(await this.visible(user, id), user);
  }

  /**
   * From the caller's cart (then the cart is emptied), or — administrators only — for a
   * given client with explicit items. Stock is taken atomically: an order either reserves
   * every item or fails as a whole.
   */
  async create(user: AuthUser, dto: CreateOrderDto) {
    const onBehalf = dto.clientId !== undefined || dto.items !== undefined;
    let clientId = user.id;
    let lines: { productId: string; quantity: number }[];

    if (onBehalf) {
      if (!isAdmin(user)) throw badRequest('Orders are placed from your cart');
      if (!dto.clientId || !dto.items?.length) throw badRequest('Pass both clientId and items');
      const client = await this.prisma.user.findUnique({ where: { id: dto.clientId } });
      if (!client || !client.isActive) throw notFound('Client');
      clientId = client.id;
      const merged = new Map<string, number>();
      for (const i of dto.items) merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.quantity);
      lines = [...merged].map(([productId, quantity]) => ({ productId, quantity }));
    } else {
      const cart = await this.prisma.cart.findUnique({ where: { userId: user.id }, include: { items: true } });
      lines = (cart?.items ?? []).map((i) => ({ productId: i.productId, quantity: i.quantity }));
      if (!lines.length) throw conflict('Your cart is empty', 'CART_EMPTY');
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } });
      const items: { productId: string; quantity: number; priceSnapshot: number }[] = [];
      for (const line of lines) {
        const product = products.find((p) => p.id === line.productId);
        if (!product) throw notFound('Product');
        if (!product.isActive) throw conflict(`${product.name} is no longer sold`, 'PRODUCT_INACTIVE', { productId: product.id });
        // Conditional decrement: two people cannot both take the last item.
        const taken = await tx.product.updateMany({
          where: { id: product.id, isActive: true, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (taken.count !== 1) {
          throw conflict(
            product.stock === 0 ? `${product.name} is sold out` : `Only ${product.stock} of ${product.name} left`,
            'OUT_OF_STOCK',
            { productId: product.id, stock: product.stock },
          );
        }
        items.push({ productId: product.id, quantity: line.quantity, priceSnapshot: product.price });
      }
      const created = await tx.order.create({
        data: {
          clientId,
          pickupCode: Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''),
          totalPrice: items.reduce((sum, i) => sum + i.priceSnapshot * i.quantity, 0),
          items: { create: items },
        },
        include: INCLUDE,
      });
      if (!onBehalf) await tx.cartItem.deleteMany({ where: { cart: { userId: user.id } } });
      return created;
    });

    await this.notifications.notify(
      clientId,
      'ORDER_PLACED',
      `Order ${order.pickupCode} received. We'll let you know when it is ready to collect.`,
    );
    return this.view(order, user);
  }

  /** Canceling restores the stock, and refunds the order if it was already paid. */
  async cancel(user: AuthUser, id: string) {
    const o = await this.visible(user, id);
    if (TERMINAL.includes(o.status)) {
      throw conflict(
        o.status === OrderStatus.RECEIVED ? 'A collected order cannot be canceled' : 'This order is already canceled',
        'NOT_CANCELABLE',
      );
    }
    const refund = await this.cancelInternal(o);
    return { ...this.view(await this.visible(user, id), user), refund };
  }

  private async cancelInternal(o: { id: string; paymentStatus: PaymentStatus; items: { productId: string; quantity: number }[] }) {
    await this.prisma.$transaction(async (tx) => {
      // Guarded update, so two concurrent cancels cannot both restore the stock.
      const changed = await tx.order.updateMany({
        where: { id: o.id, status: { notIn: TERMINAL } },
        data: { status: OrderStatus.CANCELED, canceledAt: new Date() },
      });
      if (changed.count !== 1) throw conflict('This order has just been closed', 'NOT_CANCELABLE');
      for (const item of o.items) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
    });
    await this.payments.cancelPending({ orderId: o.id });
    if (o.paymentStatus !== PaymentStatus.PAID) return 'none' as const;
    const result = await this.payments.refund({ orderId: o.id });
    return result === 'none' ? ('manual' as const) : result;
  }

  /** Used when an account is deactivated. */
  async cancelOpenOfClient(clientId: string) {
    const open = await this.prisma.order.findMany({
      where: { clientId, status: { notIn: TERMINAL } },
      include: { items: true },
    });
    for (const o of open) await this.cancelInternal(o);
    return open.length;
  }

  /** Orders move one step at a time: CREATED → IN_PROGRESS → READY → RECEIVED. */
  async setStatus(user: AuthUser, id: string, status: OrderStatus) {
    const o = await this.visible(user, id);
    if (TERMINAL.includes(o.status)) throw conflict(`A ${o.status} order cannot change`, 'TERMINAL_STATUS');
    if (NEXT[o.status] !== status) {
      throw conflict(`An order goes from ${o.status} to ${NEXT[o.status]}, not to ${status}`, 'INVALID_TRANSITION');
    }
    if (status === OrderStatus.RECEIVED && o.paymentStatus !== PaymentStatus.PAID) {
      throw conflict('Take the payment before handing the order over', 'UNPAID');
    }
    const updated = await this.prisma.order.update({ where: { id }, data: { status }, include: INCLUDE });
    if (status === OrderStatus.READY) {
      await this.notifications.notify(
        o.clientId,
        'ORDER_READY',
        `Order ${o.pickupCode} is ready to collect at the shop.`,
      );
    }
    return this.view(updated, user);
  }

  async setPaymentStatus(user: AuthUser, id: string, next: PaymentStatus) {
    const o = await this.visible(user, id);
    if (next === PaymentStatus.PAID && o.status === OrderStatus.CANCELED) {
      throw conflict('A canceled order cannot be marked as paid', 'INVALID_TRANSITION');
    }
    const paymentStatus = await this.payments.manualChange({ orderId: id }, o.paymentStatus, next);
    const updated = await this.prisma.order.update({ where: { id }, data: { paymentStatus }, include: INCLUDE });
    return this.view(updated, user);
  }
}

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Place an order from the cart. Administrators can pass clientId and items instead' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: OrdersQuery) {
    return this.orders.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }

  @Post(':id/cancel') @HttpCode(200)
  @ApiOperation({ summary: 'Cancel before RECEIVED. Stock is restored; a paid order is refunded' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.cancel(user, id);
  }

  @Roles(...ADMINS) @Patch(':id/status')
  setStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OrderStatusDto) {
    return this.orders.setStatus(user, id, dto.status);
  }

  @Roles(...ADMINS) @Patch(':id/payment-status')
  setPaymentStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentStatusDto) {
    return this.orders.setPaymentStatus(user, id, dto.paymentStatus);
  }
}
