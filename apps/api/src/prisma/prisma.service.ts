import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService — the application's database client.
 *
 * Note on imports: @gemerp/database (a workspace dependency of this app) owns
 * the schema and generates the client; it exports its TypeScript source
 * directly, which a tsc-compiled Nest dist cannot require at runtime. We
 * therefore extend PrismaClient from @prisma/client (pinned to the same
 * version as @gemerp/database, so pnpm resolves the SAME generated client
 * instance) instead of re-importing the singleton. All model types come from
 * the exact same generated schema.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Connected to Postgres');
    } catch (error) {
      // Do not crash the process: /health/ready reports the outage and the
      // client reconnects lazily on the next query.
      this.logger.error(
        `Could not connect to Postgres at startup: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
