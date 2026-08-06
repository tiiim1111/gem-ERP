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
import { EmployeesModule } from './employees/employees.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { ItemsModule } from './items/items.module';
import { LookupsModule } from './lookups/lookups.module';
import { OrgModule } from './org/org.module';
import { RolesModule } from './roles/roles.module';
import { SequencesModule } from './sequences/sequences.module';
import { UsersModule } from './users/users.module';
import { InventoryModule } from './inventory/inventory.module';
import { TransfersModule } from './transfers/transfers.module';
import { AssetsModule } from './assets/assets.module';
import { ScanModule } from './scan/scan.module';
import { ProcurementModule } from './procurement/procurement.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { SearchModule } from './search/search.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { CountsModule } from './counts/counts.module';
import { NotificationsModule } from './notifications/notifications.module';

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
    SequencesModule,
    AuthModule,
    UsersModule,
    RolesModule,
    OrgModule,
    // Phase 2: employees, lookup configuration, item master, staged imports.
    EmployeesModule,
    LookupsModule,
    ItemsModule,
    ImportsModule,
    // Phase 3: stock ledger, transfers, serialized assets, scanning.
    InventoryModule,
    TransfersModule,
    AssetsModule,
    ScanModule,
    // Phase 4: suppliers, purchase orders, goods receipts, supplier returns.
    ProcurementModule,
    // Phase 5: maintenance plans, work orders, parts issues, meter readings.
    MaintenanceModule,
    // Phase 3.5: file attachments (S3/MinIO) and cross-entity global search.
    AttachmentsModule,
    SearchModule,
    // Phase 6: physical counts, configurable approvals, in-app notifications.
    ApprovalsModule,
    CountsModule,
    NotificationsModule,
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
