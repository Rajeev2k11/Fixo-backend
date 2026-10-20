import { z } from 'zod';

import { defineConfigKey } from '../config/config.keys.js';

/**
 * The worker agreement version workers must accept (spec §C.6). The legal text is the owner's;
 * no value is seeded, so accepting fails with AGREEMENT_NOT_PUBLISHED until an admin sets one.
 */
export const WORKER_AGREEMENT_VERSION = defineConfigKey(
  'workers.agreement_version',
  z.string().min(1).max(50),
);
