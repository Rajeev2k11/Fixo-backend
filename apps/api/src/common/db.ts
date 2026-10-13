import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from './env.js';

export const DB = Symbol('DB');
export type Db = NodePgDatabase;
/** The handle inside `db.transaction(async (tx) => ...)`. Functions that must join a transaction take this. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const DB_POOL = Symbol('DB_POOL');

/** One pg pool per process, exposed to modules as a Drizzle instance via `@Inject(DB)`. */
@Global()
@Module({
  providers: [
    {
      provide: DB_POOL,
      // Fail fast instead of hanging a request when the database is unreachable.
      useFactory: () =>
        new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5_000 }),
    },
    {
      provide: DB,
      inject: [DB_POOL],
      useFactory: (pool: Pool): Db => drizzle({ client: pool, casing: 'snake_case' }),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
