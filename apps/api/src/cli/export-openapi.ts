import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildOpenApiDocument } from '../modules/docs/openapi.js';

/**
 * Writes the OpenAPI contract to packages/contracts/openapi.json (committed), so app developers
 * can generate clients without running the API. test/docs.e2e-spec.ts fails if it is stale.
 *   pnpm openapi
 */
export const OPENAPI_FILE = fileURLToPath(
  new URL('../../../../packages/contracts/openapi.json', import.meta.url),
);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(OPENAPI_FILE, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
  process.stdout.write(`Wrote ${OPENAPI_FILE}\n`);
}
