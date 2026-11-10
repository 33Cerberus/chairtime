import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter, validationExceptionFactory } from './common/errors';
import { UPLOADS_DIR } from './storage/storage.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_ACCESS_SECRET ?? '';
  if (isProd && (secret.length < 32 || secret.startsWith('change-me'))) {
    throw new Error('JWT_ACCESS_SECRET must be a random string of at least 32 characters in production');
  }

  // rawBody keeps the unparsed request for Stripe signature verification.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map((o) => o.trim()),
    credentials: true,
  });

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

  // Locally stored uploads. Served with a locked-down policy so an image can never run script,
  // and revalidated by ETag so a re-seeded demo image is never served stale.
  app.useStaticAssets(UPLOADS_DIR, {
    prefix: '/uploads',
    setHeaders: (res) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });

  const swagger = new DocumentBuilder()
    .setTitle('Chairtime API')
    .setDescription('Booking and management system for a single-branch barbershop. Conventions: docs/api.md')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  logger.log(`API on http://localhost:${port}/api/v1 — docs on http://localhost:${port}/api/docs`);
}

void bootstrap();
