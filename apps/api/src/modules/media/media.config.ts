import { z } from 'zod';

import { defineConfigKey } from '../config/config.keys.js';

/** Largest file a client may upload, in bytes (seeded at 5 MB in migration 0018). */
export const MEDIA_MAX_UPLOAD_BYTES = defineConfigKey('media.max_upload_bytes', z.int().min(1024));
