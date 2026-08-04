import { createConnection } from 'node:net';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

export interface DependencyCheck {
  status: 'up' | 'down' | 'disabled';
  latencyMs?: number;
  message?: string;
}

export interface ReadinessReport {
  status: 'ok' | 'degraded' | 'unavailable';
  checks: {
    postgres: DependencyCheck;
    redis: DependencyCheck;
    minio: DependencyCheck;
  };
}

const REDIS_TIMEOUT_MS = 1000;
const MINIO_TIMEOUT_MS = 1500;
const POSTGRES_TIMEOUT_MS = 2500;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Readiness: Postgres is fatal. Redis and MinIO are informational in
   * development but fatal in production (they back jobs and attachments).
   */
  async readiness(): Promise<{ httpStatus: number; report: ReadinessReport }> {
    const [postgres, redis, minio] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.config.s3Enabled
        ? this.checkMinio()
        : Promise.resolve({ status: 'disabled' } as DependencyCheck),
    ]);

    const optionalDown = redis.status === 'down' || minio.status === 'down';
    const report: ReadinessReport = {
      status:
        postgres.status === 'down'
          ? 'unavailable'
          : optionalDown
            ? 'degraded'
            : 'ok',
      checks: { postgres, redis, minio },
    };

    const fatal =
      postgres.status === 'down' ||
      (this.config.isProduction && optionalDown);
    return { httpStatus: fatal ? 503 : 200, report };
  }

  private async checkPostgres(): Promise<DependencyCheck> {
    const started = Date.now();
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error('timeout')),
            POSTGRES_TIMEOUT_MS,
          ).unref(),
        ),
      ]);
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        message:
          error instanceof Error && error.message === 'timeout'
            ? 'timed out'
            : 'unreachable',
      };
    }
  }

  /** Raw RESP PING — no Redis client dependency needed for a liveness probe. */
  private checkRedis(): Promise<DependencyCheck> {
    const started = Date.now();
    return new Promise((resolve) => {
      let url: URL;
      try {
        url = new URL(this.config.redisUrl);
      } catch {
        resolve({ status: 'down', message: 'invalid REDIS_URL' });
        return;
      }
      const socket = createConnection({
        host: url.hostname || 'localhost',
        port: url.port ? Number(url.port) : 6379,
        timeout: REDIS_TIMEOUT_MS,
      });
      let settled = false;
      const finish = (check: DependencyCheck) => {
        if (!settled) {
          settled = true;
          socket.destroy();
          resolve({ ...check, latencyMs: Date.now() - started });
        }
      };
      socket.on('connect', () => {
        socket.write('PING\r\n');
      });
      socket.on('data', (buffer) => {
        finish(
          buffer.toString().startsWith('+PONG')
            ? { status: 'up' }
            : { status: 'down', message: 'unexpected response' },
        );
      });
      socket.on('timeout', () => finish({ status: 'down', message: 'timed out' }));
      socket.on('error', () => finish({ status: 'down', message: 'unreachable' }));
    });
  }

  private async checkMinio(): Promise<DependencyCheck> {
    const started = Date.now();
    try {
      const response = await fetch(
        `${this.config.s3Endpoint.replace(/\/+$/, '')}/minio/health/live`,
        { signal: AbortSignal.timeout(MINIO_TIMEOUT_MS) },
      );
      return response.ok
        ? { status: 'up', latencyMs: Date.now() - started }
        : {
            status: 'down',
            latencyMs: Date.now() - started,
            message: `HTTP ${response.status}`,
          };
    } catch {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        message: 'unreachable',
      };
    }
  }
}
