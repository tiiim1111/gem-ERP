import type { Readable } from 'node:stream';
import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AppException } from '../common/errors/app.exception';
import { loadEnv } from '../config/env';

/**
 * Object-storage wrapper for attachment bytes (bucket `gemerp-attachments`,
 * spec §23). MinIO in development, any S3-compatible store in production.
 * The bucket is NEVER public — bytes only move through the API.
 *
 * Deployments without object storage set S3_ENABLED=false: every attachment
 * operation then fails fast with a clean 503 SERVICE_DISABLED envelope
 * (readiness already reports minio "disabled"), never a crash.
 */
@Injectable()
export class AttachmentStorageService {
  private readonly logger = new Logger(AttachmentStorageService.name);
  private readonly enabled: boolean;
  private readonly bucket: string;
  private client: S3Client | null = null;

  constructor() {
    const env = loadEnv();
    this.enabled = env.S3_ENABLED;
    this.bucket = env.S3_BUCKET;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 503 SERVICE_DISABLED when the deployment runs without object storage. */
  assertEnabled(): void {
    if (!this.enabled) {
      throw new AppException(
        503,
        'SERVICE_DISABLED',
        'Attachments are unavailable: this deployment has no object storage configured (S3_ENABLED=false).',
      );
    }
  }

  private getClient(): S3Client {
    if (!this.client) {
      const env = loadEnv();
      this.client = new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
        },
      });
    }
    return this.client;
  }

  /** Store enabled-but-unreachable failures behind one clean 503. */
  private storageUnavailable(operation: string, error: unknown): AppException {
    this.logger.error(
      `Object storage ${operation} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return new AppException(
      503,
      'STORAGE_UNAVAILABLE',
      'The attachment store is temporarily unreachable. Try again shortly.',
    );
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.assertEnabled();
    try {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (error) {
      throw this.storageUnavailable('upload', error);
    }
  }

  async getStream(
    key: string,
  ): Promise<{ body: Readable; contentLength?: number }> {
    this.assertEnabled();
    try {
      const result = await this.getClient().send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) {
        throw new Error('empty response body');
      }
      return {
        body: result.Body as Readable,
        contentLength: result.ContentLength,
      };
    } catch (error) {
      throw this.storageUnavailable('download', error);
    }
  }

  /**
   * Best-effort object removal — used ONLY to roll back an upload whose
   * metadata write failed. Archived attachments keep their bytes (spec §23:
   * archive, never destroy).
   */
  async deleteQuietly(key: string): Promise<void> {
    if (!this.enabled) {
      return;
    }
    try {
      await this.getClient().send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      this.logger.warn(
        `Orphaned object cleanup failed for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
