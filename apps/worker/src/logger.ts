import pino from "pino";

import { env } from "./env";

/**
 * Structured JSON logger for the worker process. One line per event, ISO
 * timestamps, `service` tag so worker output is distinguishable from apps/api
 * when logs are aggregated.
 */
export const logger = pino({
  level: env.NODE_ENV === "development" ? "debug" : "info",
  base: { service: "gemerp-worker", pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
});
