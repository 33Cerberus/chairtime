import { Body, Controller, ForbiddenException, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../common/auth-user';
import { runtime } from '../common/runtime';
import {
  LoginDto,
  PasswordResetDto,
  PasswordResetRequestDto,
  RefreshDto,
  RegisterDto,
  SetPasswordDto,
} from './auth.dto';
import { AuthService, REFRESH_COOKIE } from './auth.service';

/**
 * Sign-in endpoints are the brute-force target, so they get a much tighter limit per address.
 * It is deliberately not tiny: a whole shop shares one address. The per-number lock in
 * AuthService is what stops guessing at one account.
 */
const STRICT = { default: { limit: 20, ttl: 60_000 } };

/**
 * Defence in depth for the two endpoints that act on the refresh cookie alone: a browser
 * request must come from the web app's own origin. SameSite=Lax already keeps the cookie off
 * cross-site POSTs; this also covers browsers and setups where that is not honoured.
 * Requests without an Origin header (mobile apps, server-to-server) are not browsers.
 */
function assertOwnOrigin(req: Request) {
  const origin = req.headers.origin;
  if (!origin) return;
  const self = `${req.protocol}://${req.get('host')}`;
  if (origin !== self && !runtime.webOrigins.includes(origin)) {
    throw new ForbiddenException('This request did not come from the Chairtime web app');
  }
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Throttle(STRICT) @Post('register')
  @ApiOperation({ summary: 'Create a client account, or claim a record the shop created for this phone' })
  register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.register(dto, req, res);
  }

  @Public() @Throttle(STRICT) @Post('login') @HttpCode(200)
  @ApiOperation({ summary: 'Sign in. 429 ACCOUNT_LOCKED after 8 wrong passwords in a row for one number' })
  login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, req, res);
  }

  @Public() @Post('refresh') @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token (httpOnly cookie) and get a new access token' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOwnOrigin(req);
    return this.auth.refresh(req.cookies?.[REFRESH_COOKIE] ?? dto?.refreshToken, req, res);
  }

  @Public() @Post('logout') @HttpCode(204)
  @ApiOperation({ summary: 'Revoke this session. Works even when the access token has already expired' })
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOwnOrigin(req);
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] ?? dto?.refreshToken, res);
  }

  @Public() @Throttle(STRICT) @Post('set-password') @HttpCode(200)
  @ApiOperation({ summary: 'Choose a password using a single-use link issued by the shop' })
  setPassword(@Body() dto: SetPasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.setPassword(dto, req, res);
  }

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('password-reset/request') @HttpCode(200)
  @ApiOperation({ summary: 'Send a reset code. 503 when no SMS gateway is configured' })
  requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.auth.requestPasswordReset(dto.phoneNumber);
  }

  @Public() @Throttle(STRICT) @Post('password-reset') @HttpCode(200)
  resetPassword(@Body() dto: PasswordResetDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.resetPassword(dto, req, res);
  }
}
