/**
 * Nightly trigger for the HRIS employee sync.
 *
 * Deliberately thin: it only queues a run row. The reconciliation itself
 * lives in apps/api (src/integrations/hris) because that is where the test
 * tooling is, and the API's poller drains the queue — so a scheduled run and
 * a "Run now" from the admin page take exactly the same path.
 *
 * Idempotent: if a run is already queued or in flight, this does nothing
 * rather than stacking a second reconciliation behind it.
 */
import type { PrismaClient } from "@gemerp/database";
import type { Logger } from "pino";

export interface HrisSyncEnqueueSummary {
  queued: boolean;
  runId?: string;
  reason?: string;
}

export async function enqueueHrisEmployeeSync(
  prisma: PrismaClient,
  logger: Logger,
): Promise<HrisSyncEnqueueSummary> {
  // Writes are off, so a scheduled run would only be refused. Skip quietly
  // rather than adding a failed row to the history every night.
  if ((process.env.GEMENI_HRIS_SYNC_ENABLED ?? "").trim() !== "true") {
    logger.info("HRIS employee sync is disabled — not queueing the nightly run");
    return { queued: false, reason: "sync disabled" };
  }

  const pending = await prisma.hrisSyncRun.findFirst({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true, status: true },
  });
  if (pending) {
    logger.info(
      { runId: pending.id, status: pending.status },
      "HRIS sync already pending — not queueing another",
    );
    return { queued: false, reason: `a run is already ${pending.status}` };
  }

  const run = await prisma.hrisSyncRun.create({
    data: { trigger: "SCHEDULED", dryRun: false, status: "QUEUED" },
    select: { id: true },
  });
  logger.info({ runId: run.id }, "queued the nightly HRIS employee sync");
  return { queued: true, runId: run.id };
}
