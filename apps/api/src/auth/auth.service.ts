import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { OneTimeTokenPurpose, User } from '@prisma/client';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { badRequest, conflict } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { toUserView } from '../common/user-view';
import { NotificationsService } from '../notifications/notifications.service';
import { LoginDto, PasswordResetDto, RegisterDto, SetPasswordDto } from './auth.dto';

export const REFRESH_COOKIE = 'ct_refresh';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
const PASSWORD_LINK_TTL_HOURS = 72;
/** Two tabs refreshing at once is not token theft: a token revoked this recently may be reused once. */
const ROTATION_GRACE_MS = 10_000;

/**
 * Ends a session for good. Expiring the token as well as revoking it keeps it outside the
 * rotation grace window, which is meant only for two tabs refreshing at the same moment.
 */
const KILLED = () => ({ revokedAt: new Date(), expiresAt: new Date() });

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = async (hashed: string, password: string) => {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private get isProd() {
    return this.config.get('NODE_ENV') === 'production';
  }

  // ---- Registration and login ----------------------------------------------------------

  async register(dto: RegisterDto, req: Request, res: Response) {
    const existing = await this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } });
    if (existing?.passwordHash) {
      throw conflict('This phone number is already registered. Try signing in.', 'PHONE_TAKEN');
    }
    if (existing && !existing.isActive) {
      throw conflict('This account has been deactivated. Please contact the shop.', 'ACCOUNT_INACTIVE');
    }
    if (dto.email) {
      const emailOwner = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (emailOwner && emailOwner.id !== existing?.id) {
        throw conflict('This e-mail address is already in use', 'EMAIL_TAKEN');
      }
    }

    const passwordHash = await hashPassword(dto.password);
    let user: User;
    if (existing) {
      // A record created by the shop (by phone or at the desk) already holds this number.
      // Linking it hands over its booking history, so the caller must prove they own the phone.
      if (!dto.code) {
        const devCode = await this.issueCode(existing, OneTimeTokenPurpose.PHONE_CLAIM);
        throw conflict(
          'We already have visits under this number. Enter the code we just sent to confirm it is yours.',
          'PHONE_VERIFICATION_REQUIRED',
          this.isProd ? undefined : { devCode },
        );
      }
      await this.consumeCode(existing.id, OneTimeTokenPurpose.PHONE_CLAIM, dto.code);
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: { firstName: dto.firstName, lastName: dto.lastName, email: dto.email ?? existing.email, passwordHash },
      });
    } else {
      user = await this.prisma.user.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          phoneNumber: dto.phoneNumber,
          email: dto.email,
          passwordHash,
        },
      });
    }
    return this.startSession(user, req, res);
  }

  async login(dto: LoginDto, req: Request, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } });
    const ok = !!user?.passwordHash && (await verifyPassword(user.passwordHash, dto.password));
    if (!user || !ok) throw new UnauthorizedException('Wrong phone number or password');
    if (!user.isActive) throw new UnauthorizedException('This account has been deactivated');
    return this.startSession(user, req, res);
  }

  // ---- Sessions: short-lived access JWT + rotating refresh token -----------------------

  /**
   * The refresh token is an opaque random string. Browsers get it in an httpOnly cookie
   * scoped to /api/v1/auth; only its SHA-256 is stored. Every refresh rotates it. Presenting
   * a token that was already rotated away revokes the whole family (theft detection).
   */
  private async startSession(user: User, req: Request, res: Response, familyId: string = randomUUID()) {
    const raw = randomBytes(48).toString('base64url');
    const days = Number(this.config.get('REFRESH_TTL_DAYS') ?? 30);
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        familyId,
        expiresAt,
        userAgent: req.headers['user-agent']?.slice(0, 250),
      },
    });
    res.cookie(REFRESH_COOKIE, raw, {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      expires: expiresAt,
    });
    const withProfile = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { barberProfile: { select: { id: true } } },
    });
    const wantsBodyToken = req.headers['x-client-type'] === 'mobile';
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, role: user.role }),
      user: toUserView(withProfile),
      ...(wantsBodyToken ? { refreshToken: raw } : {}),
    };
  }

  private clearCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  async refresh(raw: string | undefined, req: Request, res: Response) {
    const denied = () => {
      this.clearCookie(res);
      return new UnauthorizedException('Session expired. Please sign in again.');
    };
    if (!raw) throw denied();
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
    if (!token || token.expiresAt < new Date() || !token.user.isActive) throw denied();

    if (token.revokedAt) {
      if (Date.now() - token.revokedAt.getTime() > ROTATION_GRACE_MS) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: token.familyId },
          data: KILLED(),
        });
        throw denied();
      }
    } else {
      await this.prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    }
    return this.startSession(token.user, req, res, token.familyId);
  }

  /** Ends this device's session: revokes the refresh token family and clears the cookie. */
  async logout(raw: string | undefined, res: Response) {
    this.clearCookie(res);
    if (!raw) return;
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (token) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: token.familyId },
        data: KILLED(),
      });
    }
  }

  /** Signs the user out everywhere, e.g. after a password change or a deactivation. */
  async revokeAllSessions(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: KILLED() });
  }

  // ---- Password links: how staff (and anyone an admin helps) get a password --------------

  /**
   * Creates a single-use link the person opens to choose their own password. Nobody but
   * them ever knows it. The link is returned to the caller once and only its hash is stored.
   */
  async createPasswordLink(userId: string) {
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PASSWORD_LINK_TTL_HOURS * 3_600_000);
    await this.prisma.$transaction([
      this.prisma.oneTimeToken.deleteMany({ where: { userId, purpose: OneTimeTokenPurpose.SET_PASSWORD } }),
      this.prisma.oneTimeToken.create({
        data: { userId, purpose: OneTimeTokenPurpose.SET_PASSWORD, tokenHash: sha256(raw), expiresAt },
      }),
    ]);
    const origin = this.config.get('WEB_ORIGIN') ?? 'http://localhost:5173';
    return { url: `${origin}/set-password?token=${raw}`, expiresAt };
  }

  async setPassword(dto: SetPasswordDto, req: Request, res: Response) {
    const token = await this.prisma.oneTimeToken.findFirst({
      where: { tokenHash: sha256(dto.token), purpose: OneTimeTokenPurpose.SET_PASSWORD, usedAt: null },
      include: { user: true },
    });
    if (!token || token.expiresAt < new Date() || !token.user.isActive) {
      throw badRequest('This link is no longer valid. Ask the shop for a new one.');
    }
    const user = await this.finishPasswordChange(token.user.id, token.id, dto.password);
    return this.startSession(user, req, res);
  }

  // ---- One-time codes --------------------------------------------------------------------

  async requestPasswordReset(phoneNumber: string) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    let devCode: string | undefined;
    if (user?.isActive && user.passwordHash) {
      devCode = await this.issueCode(user, OneTimeTokenPurpose.PASSWORD_RESET);
    }
    // Same answer whether or not the number exists, so it cannot be used to probe for accounts.
    return { ok: true, ...(this.isProd || !devCode ? {} : { devCode }) };
  }

  async resetPassword(dto: PasswordResetDto, req: Request, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } });
    if (!user?.isActive || !user.passwordHash) throw badRequest('The code is wrong or has expired');
    const tokenId = await this.consumeCode(user.id, OneTimeTokenPurpose.PASSWORD_RESET, dto.code);
    const updated = await this.finishPasswordChange(user.id, tokenId, dto.password);
    return this.startSession(updated, req, res);
  }

  private async finishPasswordChange(userId: string, tokenId: string, password: string) {
    const passwordHash = await hashPassword(password);
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.oneTimeToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({ where: { userId }, data: KILLED() }),
    ]);
    return user;
  }

  private async issueCode(user: User, purpose: OneTimeTokenPurpose) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.$transaction([
      this.prisma.oneTimeToken.deleteMany({ where: { userId: user.id, purpose } }),
      this.prisma.oneTimeToken.create({
        data: {
          userId: user.id,
          purpose,
          tokenHash: sha256(`${user.id}:${code}`),
          expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
        },
      }),
    ]);
    await this.notifications.sendSecret(
      user.phoneNumber,
      `Chairtime code: ${code}. It expires in ${OTP_TTL_MIN} minutes.`,
    );
    return code;
  }

  /** Verifies a code and returns the token id. The token is marked used by the caller's transaction or here. */
  private async consumeCode(userId: string, purpose: OneTimeTokenPurpose, code: string) {
    const token = await this.prisma.oneTimeToken.findFirst({
      where: { userId, purpose, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = () => badRequest('The code is wrong or has expired');
    if (!token || token.expiresAt < new Date() || token.attempts >= OTP_MAX_ATTEMPTS) throw invalid();
    if (token.tokenHash !== sha256(`${userId}:${code}`)) {
      await this.prisma.oneTimeToken.update({ where: { id: token.id }, data: { attempts: { increment: 1 } } });
      throw invalid();
    }
    await this.prisma.oneTimeToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
    return token.id;
  }
}
