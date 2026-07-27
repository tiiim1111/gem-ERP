/**
 * Loads the repo-root .env (and an optional package-local .env) into
 * process.env without adding a dotenv dependency, mirroring apps/api.
 * Already-set process env vars always win over file values.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFiles(baseDir: string): void {
  const candidates = [resolve(baseDir, "../../.env"), resolve(baseDir, ".env")];
  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) {
        continue;
      }
      const eq = line.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadEnvFiles(__dirname.endsWith("src") ? resolve(__dirname, "..") : __dirname);
