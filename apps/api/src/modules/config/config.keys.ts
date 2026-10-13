import { ErrorCode } from '@fixo/contracts';
import type { z } from 'zod';

import { AppError } from '../../common/app-error.js';

export interface ConfigKey<T> {
  name: string;
  schema: z.ZodType<T>;
  /** SPEC-2: revenue rules need a second admin to approve before they take effect. */
  requiresApproval: boolean;
}

const registry = new Map<string, ConfigKey<unknown>>();

/**
 * Declares a configurable value. Modules define their keys next to the code that reads them,
 * e.g. `export const LEAD_CAP = defineConfigKey('matching.lead_cap', z.int().min(1))`.
 * Defining a key sets no value: values are proposed and approved through ConfigService.
 */
export function defineConfigKey<T>(
  name: string,
  schema: z.ZodType<T>,
  options: { requiresApproval?: boolean } = {},
): ConfigKey<T> {
  if (registry.has(name)) throw new Error(`config key ${name} is defined twice`);
  const key = { name, schema, requiresApproval: options.requiresApproval ?? false };
  registry.set(name, key);
  return key;
}

export function configKey(name: string): ConfigKey<unknown> {
  const key = registry.get(name);
  if (!key) throw new AppError(ErrorCode.CONFIG_KEY_UNKNOWN, 400, `Unknown config key: ${name}`);
  return key;
}
