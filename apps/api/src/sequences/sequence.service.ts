import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Named business-number counters backed by sequence_counters.
 *
 * `next` must be called with the SAME transaction client that creates the
 * document, so the counter increment commits (or rolls back) atomically with
 * the record that consumed it. The atomic UPDATE ... RETURNING takes a row
 * lock, serializing concurrent consumers of the same key.
 */
@Injectable()
export class SequenceService {
  async next(tx: Prisma.TransactionClient, key: string): Promise<number> {
    // Ensure the counter row exists (INSERT ... ON CONFLICT under the hood).
    await tx.sequenceCounter.upsert({
      where: { key },
      update: {},
      create: { key },
    });
    const rows = await tx.$queryRaw<Array<{ last_value: bigint }>>`
      UPDATE sequence_counters
      SET last_value = last_value + 1, updated_at = NOW()
      WHERE key = ${key}
      RETURNING last_value
    `;
    return Number(rows[0].last_value);
  }
}
