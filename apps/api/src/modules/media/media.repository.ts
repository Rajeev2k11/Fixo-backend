import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import type { Db, Tx } from '../../common/db.js';
import { media, type MediaRow } from './media.schema.js';

/** The only code that reads or writes the media table. */
@Injectable()
export class MediaRepository {
  async insert(db: Db | Tx, values: typeof media.$inferInsert): Promise<MediaRow> {
    const [row] = await db.insert(media).values(values).returning();
    if (!row) throw new Error('media insert returned no row');
    return row;
  }

  /** The row only if `ownerUserId` owns it: other users' files look like they do not exist. */
  async findOwned(db: Db | Tx, id: string, ownerUserId: string): Promise<MediaRow | undefined> {
    const [row] = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.ownerUserId, ownerUserId)));
    return row;
  }

  async lockOwned(tx: Tx, id: string, ownerUserId: string): Promise<MediaRow | undefined> {
    const [row] = await tx
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.ownerUserId, ownerUserId)))
      .for('update');
    return row;
  }

  async markReady(tx: Tx, id: string, sizeBytes: number): Promise<MediaRow> {
    const [row] = await tx
      .update(media)
      .set({ status: 'ready', sizeBytes, readyAt: new Date() })
      .where(eq(media.id, id))
      .returning();
    if (!row) throw new Error(`media ${id} vanished while locked`);
    return row;
  }

  async markRejected(tx: Tx, id: string, rejectReason: string): Promise<void> {
    await tx.update(media).set({ status: 'rejected', rejectReason }).where(eq(media.id, id));
  }
}
