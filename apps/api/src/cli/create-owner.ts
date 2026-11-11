/**
 * Creates the first account on a fresh installation: the owner.
 *
 *   npm run create-owner -w apps/api -- "Marek" "Zieliński" "+48 600 000 001"
 *
 * Prints a single-use link the owner opens to choose a password. There can be only one
 * owner, so this refuses to run when one already exists.
 */
import 'dotenv/config';

import { PrismaClient, Role } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { normalizePhone } from '../common/phone';

const LINK_TTL_HOURS = 72;

async function main() {
  const [firstName, lastName, phoneInput] = process.argv.slice(2);
  if (!firstName || !lastName || !phoneInput) {
    console.error('Usage: npm run create-owner -w apps/api -- "<first name>" "<last name>" "<phone number>"');
    process.exit(1);
  }
  const phoneNumber = normalizePhone(phoneInput) as string;
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    console.error(`"${phoneInput}" is not a valid phone number. Example: "+48 600 100 200"`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findFirst({ where: { role: Role.OWNER } })) {
      console.error('An owner already exists. To get them a new password link, run the password-link command (docs/operations.md §3).');
      process.exit(1);
    }
    if (await prisma.user.findUnique({ where: { phoneNumber } })) {
      console.error(`${phoneNumber} already belongs to an account.`);
      process.exit(1);
    }
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_TTL_HOURS * 3_600_000);
    await prisma.user.create({
      data: {
        firstName,
        lastName,
        phoneNumber,
        role: Role.OWNER,
        oneTimeTokens: {
          create: { purpose: 'SET_PASSWORD', tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt },
        },
      },
    });
    const origin = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
    console.log(`Owner account created for ${firstName} ${lastName} (${phoneNumber}).`);
    console.log(`\nOpen this link once to choose the password (valid ${LINK_TTL_HOURS} hours):\n\n  ${origin}/set-password?token=${raw}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
