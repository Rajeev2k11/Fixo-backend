import type { Tx } from '../../common/db.js';
import { auditLog } from './audit.schema.js';

export interface AuditEntry {
  actorUserId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string;
  requestId?: string;
}

/**
 * Writes an audit row in the caller's transaction, so the change and its audit record
 * commit or roll back together. The database rejects an empty reason.
 */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    ...entry,
    before: entry.before ?? null,
    after: entry.after ?? null,
    requestId: entry.requestId ?? null,
  });
}
