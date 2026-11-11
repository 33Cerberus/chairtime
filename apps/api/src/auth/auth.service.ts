import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { OneTimeTokenPurpose, User } from '@prisma/client';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { badRequest, conflict } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { runtime } from '../common/runtime';
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
/** After this many wrong passwords in a row for one phone number, sign-in is paused. */
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

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
  private readonly logger = new Logger('Auth');
  /** Verified when the account does not exist, so the answer takes as long either way. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

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
        this.assertCodesCanBeSent();
        const devCode = await this.issueCode(existing, OneTimeTokenPurpose.PHONE_CLAIM);
        throw conflict(
          'We already have visits under this number. Enter the code we just sent to confirm it is yours.',
          'PHONE_VERIFICATION_REQUIRED',
          runtime.exposeDevCodes ? { devCode } : undefined,
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

  /**
   * Failed attempts are counted per phone number, whether or not an account exists for it,
   * so neither the lock nor the timing of the answer reveals which numbers are registered.
   */
  async login(dto: LoginDto, req: Request, res: Response) {
    const phoneNumber = dto.phoneNumber;
    const now = Date.now();
    const throttle = await this.prisma.loginThrottle.findUnique({ where: { phoneNumber } });
    if (throttle?.lockedUntil && throttle.lockedUntil.getTime() > now) {
      const minutes = Math.ceil((throttle.lockedUntil.getTime() - now) / 60_000);
      throw new HttpException(
        {
          message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`,
          code: 'ACCOUNT_LOCKED',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    const hashed = user?.passwordHash ?? (await (this.dummyHash ??= hashPassword(randomBytes(24).toString('hex'))));
    const matches = await verifyPassword(hashed, dto.password);
    if (!user?.passwordHash || !matches) {
      // Old failures do not count: only a burst within the lock window adds up.
      const recent = throttle && now - throttle.updatedAt.getTime() < LOCK_MINUTES * 60_000 ? throttle.failures : 0;
      const locked = recent + 1 >= MAX_FAILED_LOGINS;
      const data = {
        failures: locked ? 0 : recent + 1,
        lockedUntil: locked ? new Date(now + LOCK_MINUTES * 60_000) : null,
      };
      await this.prisma.loginThrottle.upsert({ where: { phoneNumber }, create: { phoneNumber, ...data }, update: data });
      if (locked) {
        this.logger.warn(`Sign-in paused for ${LOCK_MINUTES} minutes after ${MAX_FAILED_LOGINS} failed attempts on one number`);
      }
      throw new UnauthorizedException('Wrong phone number or password');
    }
    if (throttle) await this.prisma.loginThrottle.deleteMany({ where: { phoneNumber } });
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
      secure: runtime.isProd,
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
        await this.prisma.refreshToken.updateMany({ where: { familyId: token.familyId }, data: KILLED() });
        this.logger.warn(`A rotated refresh token was reused; every session of that sign-in was ended (user ${token.userId})`);
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
      await this.prisma.refreshToken.updateMany({ where: { familyId: token.familyId }, data: KILLED() });
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
    const origin = runtime.webOrigins[0] ?? 'http://localhost:5173';
    return { url: `${origin}/set-password?token=${raw}`, expiresAt };
  }

  async setPassword(dto: SetPasswordDto, req: Request, res: Response) {
    const invalid = () => badRequest('This link is no longer valid. Ask the shop for a new one.');
    const token = await this.prisma.oneTimeToken.findFirst({
      where: { tokenHash: sha256(dto.token), purpose: OneTimeTokenPurpose.SET_PASSWORD, usedAt: null },
      include: { user: true },
    });
    if (!token || token.expiresAt < new Date() || !token.user.isActive) throw invalid();
    // Claim the link first: of two requests racing with the same link, only one may win.
    const claimed = await this.prisma.oneTimeToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalid();
    const user = await this.changePassword(token.user.id, dto.password);
    return this.startSession(user, req, res);
  }

  // ---- One-time codes --------------------------------------------------------------------

  async requestPasswordReset(phoneNumber: string) {
    this.assertCodesCanBeSent();
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    let devCode: string | undefined;
    if (user?.isActive && user.passwordHash) {
      devCode = await this.issueCode(user, OneTimeTokenPurpose.PASSWORD_RESET);
    }
    // Same answer whether or not the number exists, so it cannot be used to probe for accounts.
    return { ok: true, ...(runtime.exposeDevCodes && devCode ? { devCode } : {}) };
  }

  async resetPassword(dto: PasswordResetDto, req: Request, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } });
    if (!user?.isActive || !user.passwordHash) throw badRequest('The code is wrong or has expired');
    await this.consumeCode(user.id, OneTimeTokenPurpose.PASSWORD_RESET, dto.code);
    const updated = await this.changePassword(user.id, dto.password);
    // Proving ownership of the phone also lifts a lock caused by wrong passwords.
    await this.prisma.loginThrottle.deleteMany({ where: { phoneNumber: dto.phoneNumber } });
    return this.startSession(updated, req, res);
  }

  /** Sets a new password and signs the user out everywhere else. */
  private async changePassword(userId: string, password: string) {
    const passwordHash = await hashPassword(password);
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({ where: { userId }, data: KILLED() }),
    ]);
    return user;
  }

  /** Without a way to deliver a code, flows that depend on one are refused up front, for everyone. */
  private assertCodesCanBeSent() {
    if (!this.notifications.canSendSecrets) {
      throw new ServiceUnavailableException('Text messages are not available right now. Please contact the shop.');
    }
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
    // Sent in the background, so the response time does not reveal whether the number has an account.
    void this.notifications
      .sendSecret(user.phoneNumber, `Chairtime code: ${code}. It expires in ${OTP_TTL_MIN} minutes.`)
      .catch((e) => this.logger.error(`Could not send a one-time code: ${e instanceof Error ? e.message : e}`));
    return code;
  }

  /** Verifies a code and uses it up. A code works exactly once, even for two requests arriving together. */
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
    const claimed = await this.prisma.oneTimeToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalid();
  }
}
