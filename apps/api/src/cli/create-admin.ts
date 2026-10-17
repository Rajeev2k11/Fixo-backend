import 'reflect-metadata';

import { parseArgs } from 'node:util';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { AdminAuthService } from '../modules/auth/admin-auth.service.js';

/**
 * Creates an admin account and prints a one-time password.
 *   pnpm admin:create --email ops@fixo.in --name "Asha Verma" --role super_admin [--role finance]
 * The admin then logs in at POST /v1/admin/auth/login and must enrol MFA on first login.
 */
const SYSTEM_ACTOR = { userId: '00000000-0000-0000-0000-000000000001', role: 'system' };

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', multiple: true },
      reason: { type: 'string', default: 'Admin created with the CLI' },
    },
  });
  if (!values.email || !values.name || !values.role?.length) {
    throw new Error('usage: admin:create --email <email> --name <name> --role <code> [--role ...]');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const { userId, password } = await app.get(AdminAuthService).createAdmin({
      email: values.email,
      displayName: values.name,
      roleCodes: values.role,
      actor: SYSTEM_ACTOR,
      reason: values.reason,
    });
    // Printed once, to the operator's terminal only; it is not logged anywhere.
    process.stdout.write(
      `Admin created: ${values.email} (${userId})\nOne-time password: ${password}\n` +
        'Store it in a password manager now; it cannot be shown again.\n',
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
