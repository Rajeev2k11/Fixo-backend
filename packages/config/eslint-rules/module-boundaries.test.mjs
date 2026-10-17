import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';

import { moduleBoundaries } from './module-boundaries.mjs';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const IN_AUTH = '/repo/apps/api/src/modules/auth/auth.service.ts';
const IN_AUTH_DOMAIN = '/repo/apps/api/src/modules/auth/domain/otp.rules.ts';

tester.run('module-boundaries', moduleBoundaries, {
  valid: [
    // another module's public surface
    { filename: IN_AUTH, code: "import { UsersService } from '../users/users.service.js';" },
    { filename: IN_AUTH, code: "import { UsersModule } from '../users/users.module.js';" },
    { filename: IN_AUTH, code: "import { user } from '../users/users.schema.js';" },
    { filename: IN_AUTH, code: "import { defineConfigKey } from '../config/config.keys.js';" },
    // own internals
    { filename: IN_AUTH, code: "import { AuthRepository } from './auth.repository.js';" },
    { filename: IN_AUTH_DOMAIN, code: "import { x } from '../auth.repository.js';" },
    // outside modules (common, platform, packages)
    { filename: IN_AUTH, code: "import { AppError } from '../../common/app-error.js';" },
    { filename: IN_AUTH, code: "import { z } from 'zod';" },
    // files outside src/modules are not checked
    {
      filename: '/repo/apps/api/src/jobs.module.ts',
      code: "import { AuthRepository } from './modules/auth/auth.repository.js';",
    },
  ],
  invalid: [
    {
      filename: IN_AUTH,
      code: "import { UsersRepository } from '../users/users.repository.js';",
      errors: [{ messageId: 'internal' }],
    },
    {
      filename: IN_AUTH,
      code: "import { canTransition } from '../users/domain/user.state-machine.js';",
      errors: [{ messageId: 'internal' }],
    },
    {
      filename: IN_AUTH_DOMAIN,
      code: "export * from '../../config/config.repository.js';",
      errors: [{ messageId: 'internal' }],
    },
  ],
});
