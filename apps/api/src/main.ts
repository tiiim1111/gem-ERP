import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { correlationIdMiddleware } from './common/middleware/correlation-id';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { validationExceptionFactory } from './common/errors/app.exception';
import { AppConfigService } from './config/app-config.service';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  // Fail fast on invalid environment before anything else spins up.
  loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();

  const config = app.get(AppConfigService);

  if (config.isProduction) {
    // Honor X-Forwarded-* from the reverse proxy (correct req.ip / req.protocol).
    app.set('trust proxy', 1);
  }

  app.use(correlationIdMiddleware);
  app.use(
    helmet({
      // CSP tuned so the Swagger UI at /api/docs still works.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());

  app.enableCors({
    origin: config.webOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-request-id', 'Idempotency-Key'],
    exposedHeaders: ['x-request-id'],
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
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('GEM-ENI API')
    .setDescription(
      'Asset & Inventory Management for GEM Cor — Phase 1: authentication, ' +
        'users, roles & permissions, organization structure, audit trail, health. ' +
        'Phase 2: employees, lookup configuration, item master (UOMs, barcodes, ' +
        'warehouse settings), staged CSV imports.',
    )
    .setVersion('1.0')
    .addCookieAuth(config.sessionCookieName)
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // Cookie-scheme sanity check. A mismatch here surfaces to users as "login
  // does nothing" (the browser silently discards a Secure cookie on http://),
  // which is near-impossible to diagnose from the UI — so say it at boot.
  const primaryOrigin = config.webOrigins[0] ?? '';
  if (config.sessionCookieSecure && primaryOrigin.startsWith('http://')) {
    logger.error(
      `SESSION_COOKIE_SECURE=true but WEB_ORIGIN is ${primaryOrigin} (plain HTTP). ` +
        'Browsers discard Secure cookies over HTTP, so NOBODY WILL BE ABLE TO SIGN IN. ' +
        'Set SESSION_COOKIE_SECURE=false, or serve the app over HTTPS.',
      'Bootstrap',
    );
  } else if (!config.sessionCookieSecure && primaryOrigin.startsWith('https://')) {
    logger.warn(
      `SESSION_COOKIE_SECURE=false but WEB_ORIGIN is ${primaryOrigin} (HTTPS). ` +
        'Session cookies will not be marked Secure — set SESSION_COOKIE_SECURE=true.',
      'Bootstrap',
    );
  }

  // '::' = dual-stack bind (IPv4 + IPv6). Container networks and health probes
  // may reach the service over either family; an IPv4-only bind drops the rest.
  await app.listen(config.apiPort, '::');
  logger.log(
    `GEM-ENI API listening on port ${config.apiPort} ` +
      `(prefix /api/v1, docs at /api/docs, env ${config.nodeEnv})`,
    'Bootstrap',
  );
}

void bootstrap();
