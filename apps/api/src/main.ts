// Must stay first: other modules read the environment while they are being imported.
import 'dotenv/config';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import helmet from 'helmet';
import { join, resolve } from 'path';
import { AppModule } from './app.module';
import { AuthUser } from './common/auth-user';
import { AllExceptionsFilter, validationExceptionFactory } from './common/errors';
import { checkEnvironment, NODE_ENV, runtime } from './common/runtime';
import { UPLOADS_DIR } from './storage/storage.service';

type TrackedRequest = Request & { id?: string; user?: AuthUser };

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // Refuses to start on a configuration that cannot work or is not safe.
  const warnings = checkEnvironment();

  // rawBody keeps the unparsed request for Stripe signature verification.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.disable('x-powered-by');
  // Behind a reverse proxy the client address and protocol come from its headers.
  if (runtime.trustProxy) app.set('trust proxy', runtime.trustProxy);

  // ---- Request id and access log ------------------------------------------------------------
  // One line per request: method, route pattern, status, time, who. Never the query string or
  // the body — searches carry names and phone numbers.
  const http = new Logger('HTTP');
  app.use((req: TrackedRequest, res: Response, next: NextFunction) => {
    const given = req.headers['x-request-id'];
    req.id = typeof given === 'string' && /^[\w-]{8,64}$/.test(given) ? given : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (!req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/api/v1/health')) return;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.originalUrl.split('?')[0];
      const line = `${req.method} ${route} ${res.statusCode} ${ms.toFixed(0)}ms user=${req.user?.id ?? '-'} rid=${req.id}`;
      if (res.statusCode >= 500) http.error(line);
      else if (res.statusCode >= 400) http.warn(line);
      else http.log(line);
    });
    next();
  });

  // ---- Security headers ---------------------------------------------------------------------
  app.use(
    helmet({
      // In production the API may also serve the web app, so the policy is written for it:
      // own scripts only, plus Stripe's hosted fields. Styles need 'unsafe-inline' for React
      // style attributes. In development the web app is served by Vite, not from here.
      contentSecurityPolicy: runtime.isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", 'https://js.stripe.com'],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'", 'https://api.stripe.com'],
              frameSrc: ['https://js.stripe.com', 'https://hooks.stripe.com'],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginResourcePolicy: { policy: runtime.isProd ? 'same-site' : 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.enableCors({ origin: runtime.webOrigins, credentials: true, maxAge: 600 });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // ---- Static files -------------------------------------------------------------------------
  // Locally stored uploads. Served with a locked-down policy so an image can never run script,
  // and revalidated by ETag so a re-seeded demo image is never served stale.
  app.useStaticAssets(UPLOADS_DIR, {
    prefix: '/uploads',
    setHeaders: (res) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });

  // The built web app, when WEB_DIST points at it: one origin for pages, API and cookies.
  const webDist = runtime.webDist ? resolve(runtime.webDist) : '';
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    app.useStaticAssets(webDist, {
      index: false,
      setHeaders: (res, path) => {
        // Vite fingerprints everything under /assets, so those files can be cached forever.
        const hashed = path.replace(/\\/g, '/').includes('/assets/');
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    // Client-side routes: any other page request gets the app shell.
    app.use((req: Request, res: Response, next: NextFunction) => {
      const page = req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/uploads/') && !/\.\w+$/.test(req.path);
      if (!page) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(webDist, 'index.html'));
    });
    logger.log(`Serving the web app from ${webDist}`);
  } else if (webDist) {
    logger.warn(`WEB_DIST is set to ${webDist}, but there is no index.html there. The web app is not being served.`);
  }

  if (runtime.apiDocs) {
    const swagger = new DocumentBuilder()
      .setTitle('Chairtime API')
      .setDescription('Booking and management system for a single-branch barbershop. Conventions: docs/api.md')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
  }

  app.enableShutdownHooks();
  await app.listen(runtime.port);
  logger.log(`Chairtime API (${NODE_ENV}) on port ${runtime.port}${runtime.apiDocs ? ' — docs at /api/docs' : ''}`);
  for (const w of warnings) logger.warn(w);
}

bootstrap().catch((e) => {
  // A configuration error should read as one, not as a stack trace.
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
