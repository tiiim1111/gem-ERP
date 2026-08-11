/**
 * Object-storage helper for export files — the worker-side mirror of the
 * API's AttachmentStorageService (same bucket, same S3/MinIO envs, bucket
 * never public: downloads always proxy through the API).
 *
 * S3_ENABLED=false or an unreachable store NEVER crashes the worker: both
 * raise ExportStorageError, which the exports processor converts into a
 * FAILED job with a human-readable error.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "./env";

export class ExportStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportStorageError";
  }
}

let client: S3Client | null = null;

function getClient(): S3Client {
  client ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
  });
  return client;
}

export function isStorageEnabled(): boolean {
  return env.S3_ENABLED;
}

/** Upload one export file; throws ExportStorageError on any storage problem. */
export async function putExportObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (!env.S3_ENABLED) {
    throw new ExportStorageError(
      "Object storage is disabled (S3_ENABLED=false) — the export file cannot be stored. Enable S3/MinIO and queue the export again.",
    );
  }
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (error) {
    throw new ExportStorageError(
      `The object store is unreachable: ${
        error instanceof Error ? error.message : String(error)
      }. Try again once storage is available.`,
    );
  }
}
