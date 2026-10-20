import { describe, expect, it } from 'vitest';

import {
  canEditWorkerProfile,
  canTransitionWorker,
  WORKER_STATUSES,
  type WorkerStatus,
} from './worker.state-machine.js';

// Decision WORKER-1, written out move by move.
const ALLOWED: [WorkerStatus, WorkerStatus][] = [
  ['registered', 'kyc_pending'],
  ['kyc_pending', 'under_review'],
  ['under_review', 'verified'],
  ['under_review', 'rejected'],
  ['under_review', 'registered'],
  ['verified', 'under_review'],
  ['verified', 'suspended'],
  ['suspended', 'verified'],
  ['rejected', 'registered'],
];

describe('worker status machine (WORKER-1)', () => {
  // All 36 pairs are listed, so adding a status or a move forces this test to be updated.
  const pairs = WORKER_STATUSES.flatMap((from) => WORKER_STATUSES.map((to) => [from, to] as const));

  it.each(pairs)('%s -> %s', (from, to) => {
    expect(canTransitionWorker(from, to)).toBe(ALLOWED.some(([f, t]) => f === from && t === to));
  });

  it('allows profile edits only before submitting', () => {
    expect(WORKER_STATUSES.filter(canEditWorkerProfile)).toEqual(['registered']);
  });
});
