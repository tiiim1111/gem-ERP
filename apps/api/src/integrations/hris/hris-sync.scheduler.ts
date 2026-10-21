/*
 * Drains queued HRIS sync runs.
 *
 * The API has no scheduler or queue client of its own, and the engine lives
 * here because this is where the test tooling is. So the worker's nightly
 * BullMQ job and the admin UI both just queue a run row, and this poller
 * executes it — one path for every trigger, and the advisory lock inside the
 * engine keeps concurrent API replicas from overlapping.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { HrisSyncService } from './hris-sync.service';

@Injectable()
export class HrisSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HrisSyncScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly sync: HrisSyncService,
  ) {}

  onModuleInit(): void {
    const hris = this.config.hris;
    if (!hris.enabled) {
      this.logger.log(
        'HRIS employee sync is disabled (GEMENI_HRIS_SYNC_ENABLED=false) — queued runs will not execute',
      );
      return;
    }
    if (!this.config.hrisConfigured) {
      this.logger.warn(
        'HRIS employee sync is enabled but not configured — set GEMENI_HRIS_BASE_URL and GEMENI_HRIS_TOKEN',
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), hris.pollMs);
    // Do not hold the process open on shutdown.
    this.timer.unref?.();
    this.logger.log(`HRIS sync poller started (every ${hris.pollMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One poll. Guarded in-process as well as by the database lock: without the
   * local guard a slow run would have overlapping ticks all contending for the
   * same lock and logging noise.
   */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const runId = await this.sync.drainOnce();
      if (runId) this.logger.debug(`Processed HRIS sync run ${runId}`);
    } catch (error) {
      this.logger.error(
        `HRIS sync poll failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
