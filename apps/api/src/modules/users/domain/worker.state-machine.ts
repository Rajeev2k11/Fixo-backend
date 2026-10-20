// Pure: no framework imports (CLAUDE.md folder layout). Decision WORKER-1.

export const WORKER_STATUSES = [
  'registered',
  'kyc_pending',
  'under_review',
  'verified',
  'rejected',
  'suspended',
] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

const ALLOWED: Record<WorkerStatus, readonly WorkerStatus[]> = {
  registered: ['kyc_pending'], // worker submits for review
  kyc_pending: ['under_review'], // the KYC provider's checks came back
  under_review: ['verified', 'rejected', 'registered'], // admin decides; registered = resubmit
  verified: ['under_review', 'suspended'], // KYC expired or re-review; worker-level suspension
  suspended: ['verified'], // restored
  rejected: ['registered'], // only when an admin reopens the application
};

export function canTransitionWorker(from: WorkerStatus, to: WorkerStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Name, photo and city can change until the worker submits, or after being sent back. */
export function canEditWorkerProfile(status: WorkerStatus): boolean {
  return status === 'registered';
}
