/**
 * Runtime configuration, read once from the environment.
 *
 * Secure by default: when NODE_ENV is not set, the API behaves as in production. Development
 * conveniences (codes echoed in responses, mock payments, API docs) must be asked for.
 */

const env = process.env;
const on = (v: string | undefined) => v === 'true' || v === '1';

export const NODE_ENV = env.NODE_ENV || 'production';
export const isProd = NODE_ENV === 'production';

export const runtime = {
  isProd,
  port: Number(env.PORT ?? 4000),
  webOrigins: (env.WEB_ORIGIN ?? (isProd ? '' : 'http://localhost:5173'))
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),

  /** One-time codes are returned in API responses. Never in production. */
  exposeDevCodes: !isProd,
  /** The mock payment provider settles payments without money moving. */
  mockPayments: !env.STRIPE_SECRET_KEY && (!isProd || on(env.ALLOW_MOCK_PAYMENTS)),
  /** Swagger UI at /api/docs. */
  apiDocs: !isProd || on(env.ENABLE_API_DOCS),
  /** Messages are printed to the log instead of being sent. */
  consoleMessages: !isProd,

  /** Folder with the built web app; when present the API serves it, so everything is one origin. */
  webDist: env.WEB_DIST || '',
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || 1 : 0,

  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    publishableKey: env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  },
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    from: env.TWILIO_FROM || '',
  },
};

export const smsConfigured = () => !!(runtime.twilio.accountSid && runtime.twilio.authToken && runtime.twilio.from);

/**
 * Fails fast on a configuration that cannot work or is not safe, and returns warnings for
 * features that will be unavailable. Called before the application starts.
 */
export function checkEnvironment(): string[] {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!env.DATABASE_URL) errors.push('DATABASE_URL is required.');

  const secret = env.JWT_ACCESS_SECRET ?? '';
  if (!secret) errors.push('JWT_ACCESS_SECRET is required.');
  else if (isProd && (secret.length < 32 || /change-me|secret|password/i.test(secret))) {
    errors.push('JWT_ACCESS_SECRET must be a random string of at least 32 characters in production.');
  }

  if (isProd) {
    if (!runtime.webOrigins.length) errors.push('WEB_ORIGIN is required in production (the public https:// address of the web app).');
    for (const origin of runtime.webOrigins) {
      const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (!origin.startsWith('https://') && !local) {
        errors.push(`WEB_ORIGIN "${origin}" must use https:// — the session cookie is only sent over a secure connection.`);
      }
    }
  }

  const s = runtime.stripe;
  if (s.secretKey && (!s.publishableKey || !s.webhookSecret)) {
    errors.push('Stripe needs all three: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET.');
  }
  if (isProd && on(env.ALLOW_MOCK_PAYMENTS)) {
    warnings.push('ALLOW_MOCK_PAYMENTS is on: "online payments" settle without any money moving.');
  } else if (isProd && !s.secretKey) {
    warnings.push('Stripe is not configured: online payment is switched off; clients pay at the shop.');
  }
  if (isProd && s.secretKey.startsWith('sk_test_')) warnings.push('Stripe is using a TEST key.');

  const t = runtime.twilio;
  const twilioParts = [t.accountSid, t.authToken, t.from].filter(Boolean).length;
  if (twilioParts > 0 && twilioParts < 3) {
    errors.push('SMS needs all three: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.');
  }
  if (isProd && twilioParts === 0) {
    warnings.push(
      'No SMS gateway is configured: reminders are not sent, and password reset and linking an account to a phone record are unavailable.',
    );
  }

  if (isProd && !env.S3_BUCKET) {
    warnings.push('S3_BUCKET is not set: photos are stored on local disk. Mount a persistent volume at ./uploads.');
  }

  if (errors.length) {
    throw new Error(`Invalid configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  return warnings;
}
