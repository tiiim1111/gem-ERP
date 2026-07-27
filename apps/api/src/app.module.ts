import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { loadEnv } from './config/env';
import { generateRequestId } from './common/middleware/correlation-id';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { PermissionsGuard } from './rbac/permissions.guard';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CsrfOriginGuard } from './auth/csrf-origin.guard';
import { SessionAuthGuard } from './auth/session-auth.guard';
import { HealthModule } from './health/health.module';
import { OrgModule } from './org/org.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';

const env = loadEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level:
          env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
        genReqId: (req) => generateRequestId(req),
        // Credentials and session tokens never reach the logs.
        redact: {
          paths: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers["set-cookie"]',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
        autoLogging: {
          ignore: (req) => (req.url ?? '').startsWith('/api/v1/health'),
        },
        customProps: (req) => ({
          correlationId: (req as { id?: unknown }).id,
        }),
        transport:
          env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname',
                },
              },
      },
    }),
    AppConfigModule,
    PrismaModule,
    RbacModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RolesModule,
    OrgModule,
    HealthModule,
  ],
  providers: [
    // Global guards run in registration order:
    // 1. CSRF origin validation on state-changing requests,
    // 2. session resolution (attaches AuthUser),
    // 3. permission enforcement (deny unless declared or public).
    { provide: APP_GUARD, useClass: CsrfOriginGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
