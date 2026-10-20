import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { Db, Tx } from '../../common/db.js';
import { workerArea, workerKyc, workerPreference, workerService } from './workers.schema.js';

export interface Capabilities {
  cityId: string;
  wholeCity: boolean;
  areaIds: string[];
  categoryIds: string[];
  availability: {
    days: string[];
    allDay: boolean;
    startTime: string;
    endTime: string;
    emergency: boolean;
  };
  kyc: { aadhaarFrontMediaId: string; aadhaarBackMediaId: string; selfieMediaId: string };
}

/** The only code that reads or writes the workers module's tables. */
@Injectable()
export class WorkersRepository {
  /** Replaces everything a submission carries; a resubmission overwrites the previous one. */
  async replace(tx: Tx, userId: string, c: Capabilities): Promise<void> {
    await tx.delete(workerArea).where(eq(workerArea.userId, userId));
    await tx.delete(workerService).where(eq(workerService.userId, userId));
    if (c.areaIds.length > 0) {
      await tx
        .insert(workerArea)
        .values(c.areaIds.map((areaId) => ({ userId, areaId, cityId: c.cityId })));
    }
    await tx
      .insert(workerService)
      .values(c.categoryIds.map((categoryId) => ({ userId, categoryId, cityId: c.cityId })));

    const preference = {
      cityId: c.cityId,
      wholeCity: c.wholeCity,
      ...c.availability,
      updatedAt: new Date(),
    };
    await tx
      .insert(workerPreference)
      .values({ userId, ...preference })
      .onConflictDoUpdate({ target: workerPreference.userId, set: preference });

    const kyc = { cityId: c.cityId, ...c.kyc, submittedAt: new Date() };
    await tx
      .insert(workerKyc)
      .values({ userId, ...kyc })
      .onConflictDoUpdate({ target: workerKyc.userId, set: kyc });
  }

  async find(
    db: Db | Tx,
    userId: string,
  ): Promise<{
    areaIds: string[];
    categoryIds: string[];
    preference: typeof workerPreference.$inferSelect | undefined;
    kycSubmitted: boolean;
  }> {
    const [areas, services, [preference], [kyc]] = await Promise.all([
      db.select({ id: workerArea.areaId }).from(workerArea).where(eq(workerArea.userId, userId)),
      db
        .select({ id: workerService.categoryId })
        .from(workerService)
        .where(eq(workerService.userId, userId)),
      db.select().from(workerPreference).where(eq(workerPreference.userId, userId)),
      db.select({ id: workerKyc.id }).from(workerKyc).where(eq(workerKyc.userId, userId)),
    ]);
    return {
      areaIds: areas.map((a) => a.id),
      categoryIds: services.map((s) => s.id),
      preference,
      kycSubmitted: kyc !== undefined,
    };
  }
}
