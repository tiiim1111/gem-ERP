import { HrisSyncScheduler } from './hris-sync.scheduler';
import type { AppConfigService } from '../../config/app-config.service';
import type { HrisSyncService } from './hris-sync.service';

/*
 * The documented rollout is: deploy with writing disabled, dry-run, review the
 * mappings and the default branch, then enable. That only works if the poller
 * runs while writing is off — otherwise the rehearsal is queued and never
 * executed, and the sequence is impossible. This file exists because that is
 * exactly what shipped the first time.
 */

function build(options: { enabled: boolean; configured: boolean }) {
  const config = {
    hris: {
      enabled: options.enabled,
      baseUrl: options.configured ? 'http://hris.test' : undefined,
      token: options.configured ? 'a-token' : undefined,
      pollMs: 30000,
    },
    hrisConfigured: options.configured,
  } as unknown as AppConfigService;
  const sync = { drainOnce: jest.fn().mockResolvedValue(null) };
  const scheduler = new HrisSyncScheduler(config, sync as unknown as HrisSyncService);
  return { scheduler, sync };
}

describe('HrisSyncScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('polls while writing is disabled, so a dry run can execute', () => {
    const { scheduler, sync } = build({ enabled: false, configured: true });
    scheduler.onModuleInit();

    jest.advanceTimersByTime(30000);
    expect(sync.drainOnce).toHaveBeenCalledTimes(1);

    scheduler.onModuleDestroy();
  });

  it('polls when writing is enabled', () => {
    const { scheduler, sync } = build({ enabled: true, configured: true });
    scheduler.onModuleInit();

    jest.advanceTimersByTime(30000);
    expect(sync.drainOnce).toHaveBeenCalledTimes(1);

    scheduler.onModuleDestroy();
  });

  /* Nothing to poll for, and every tick would fail the same way. */
  it('does not poll when the feed is not configured', () => {
    const { scheduler, sync } = build({ enabled: true, configured: false });
    scheduler.onModuleInit();

    jest.advanceTimersByTime(120000);
    expect(sync.drainOnce).not.toHaveBeenCalled();
  });

  it('stops polling on shutdown', () => {
    const { scheduler, sync } = build({ enabled: true, configured: true });
    scheduler.onModuleInit();
    scheduler.onModuleDestroy();

    jest.advanceTimersByTime(120000);
    expect(sync.drainOnce).not.toHaveBeenCalled();
  });

  /*
   * A run that takes longer than the interval would otherwise pile up
   * overlapping ticks, all contending for the same advisory lock.
   */
  it('does not start a second poll while one is still running', async () => {
    const { scheduler, sync } = build({ enabled: true, configured: true });
    let release: () => void = () => undefined;
    sync.drainOnce.mockImplementation(
      () => new Promise<null>((resolve) => {
        release = () => resolve(null);
      }),
    );
    scheduler.onModuleInit();

    jest.advanceTimersByTime(30000);
    jest.advanceTimersByTime(30000);
    jest.advanceTimersByTime(30000);
    expect(sync.drainOnce).toHaveBeenCalledTimes(1);

    release();
    await Promise.resolve();
    scheduler.onModuleDestroy();
  });

  /* A failing poll must not kill the interval — the next one has to try. */
  it('keeps polling after a failure', async () => {
    const { scheduler, sync } = build({ enabled: true, configured: true });
    sync.drainOnce.mockRejectedValueOnce(new Error('db down')).mockResolvedValue(null);
    scheduler.onModuleInit();

    jest.advanceTimersByTime(30000);
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(30000);
    expect(sync.drainOnce).toHaveBeenCalledTimes(2);

    scheduler.onModuleDestroy();
  });
});
