/**
 * Issues a single-use password link for any active account, from the server's command line.
 * This is the way back in when the owner is locked out and no SMS gateway is configured.
 *
 *   npm run password-link -w apps/api -- "+48 600 000 001"
 *
 * Anyone who can run this already has full access to the database, so it adds no new power.
 */
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { normalizePhone } from '../common/phone';

const LINK_TTL_HOURS = 72;

async function main() {
  const phoneNumber = normalizePhone(process.argv[2] ?? '') as string;
  if (!phoneNumber) {
    console.error('Usage: npm run password-link -w apps/api -- "<phone number>"');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { phoneNumber } });
    if (!user || !user.isActive) {
      console.error(`No active account with the number ${phoneNumber}.`);
      process.exit(1);
    }
    const raw = randomBytes(32).toString('base64url');
    await prisma.$transaction([
      prisma.oneTimeToken.deleteMany({ where: { userId: user.id, purpose: 'SET_PASSWORD' } }),
      prisma.oneTimeToken.create({
        data: {
          userId: user.id,
          purpose: 'SET_PASSWORD',
          tokenHash: createHash('sha256').update(raw).digest('hex'),
          expiresAt: new Date(Date.now() + LINK_TTL_HOURS * 3_600_000),
        },
      }),
      // A lock from wrong passwords should not outlive the reset.
      prisma.loginThrottle.deleteMany({ where: { phoneNumber } }),
    ]);
    const origin = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
    console.log(`Single-use password link for ${user.firstName} (${user.role}), valid ${LINK_TTL_HOURS} hours:\n\n  ${origin}/set-password?token=${raw}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
