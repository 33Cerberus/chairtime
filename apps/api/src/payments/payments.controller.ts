import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { IsIn } from 'class-validator';
import { Request } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth-user';
import { PaymentsService } from './payments.service';

class MockConfirmDto {
  @IsIn(['succeeded', 'failed'])
  outcome: 'succeeded' | 'failed';
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public() @Get('payments/config')
  @ApiOperation({ summary: 'Which provider is active (stripe or mock) and the publishable key' })
  config() {
    return this.payments.publicConfig();
  }

  @Roles(Role.CLIENT) @Post('bookings/:id/payments')
  @ApiOperation({ summary: 'Start an online payment for an own booking' })
  payBooking(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.startForBooking(user, id);
  }

  @Post('orders/:id/payments')
  @ApiOperation({ summary: 'Start an online payment for an own order' })
  payOrder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.startForOrder(user, id);
  }

  @Post('payments/:id/mock-confirm') @HttpCode(200)
  @ApiOperation({ summary: 'Local development only: settle a mock payment. Disabled when Stripe is configured' })
  mockConfirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MockConfirmDto) {
    return this.payments.mockConfirm(user, id, dto.outcome);
  }

  @Public() @SkipThrottle() @Post('webhooks/stripe') @HttpCode(200)
  @ApiOperation({ summary: 'Stripe webhook. Verified by signature, not by JWT' })
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.payments.handleWebhook(req.rawBody, signature);
  }
}
