import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../common/auth-user';
import {
  LoginDto,
  PasswordResetDto,
  PasswordResetRequestDto,
  RefreshDto,
  RegisterDto,
  SetPasswordDto,
} from './auth.dto';
import { AuthService, REFRESH_COOKIE } from './auth.service';

/** Sign-in endpoints are the brute-force target, so they get a much tighter limit. */
const STRICT = { default: { limit: 10, ttl: 60_000 } };

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
  login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, req, res);
  }

  @Public() @Post('refresh') @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token (httpOnly cookie) and get a new access token' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.refresh(req.cookies?.[REFRESH_COOKIE] ?? dto?.refreshToken, req, res);
  }

  @Public() @Post('logout') @HttpCode(204)
  @ApiOperation({ summary: 'Revoke this session. Works even when the access token has already expired' })
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] ?? dto?.refreshToken, res);
  }

  @Public() @Throttle(STRICT) @Post('set-password') @HttpCode(200)
  @ApiOperation({ summary: 'Choose a password using a single-use link issued by the shop' })
  setPassword(@Body() dto: SetPasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.setPassword(dto, req, res);
  }

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('password-reset/request') @HttpCode(200)
  requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.auth.requestPasswordReset(dto.phoneNumber);
  }

  @Public() @Throttle(STRICT) @Post('password-reset') @HttpCode(200)
  resetPassword(@Body() dto: PasswordResetDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.resetPassword(dto, req, res);
  }
}
