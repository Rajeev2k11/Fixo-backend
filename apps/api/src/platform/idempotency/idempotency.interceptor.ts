import { createHash } from 'node:crypto';

import { ErrorCode } from '@fixo/contracts';
import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';

import { AppError } from '../../common/app-error.js';
import { DB, type Db } from '../../common/db.js';
import { idempotencyKey } from './idempotency.schema.js';

const IDEMPOTENT = Symbol('IDEMPOTENT');
// ponytail: fixed 24h replay window and no cleanup job yet; add a sweeper when the table grows.
const TTL_HOURS = 24;

/** Marks a route as requiring an Idempotency-Key header (create-booking, accept-quote, payments...). */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT, true);

/**
 * Makes retries of @Idempotent() routes safe: the first request runs, repeats get the stored
 * response, and a concurrent repeat gets 409 instead of running the handler twice.
 *
 * ponytail: the response is stored after the handler's own transaction commits. If the process
 * dies in between, the key stays in_progress and retries get 409 until it expires. That fails
 * closed (never a duplicate write). Move the store into the handler's transaction if 409s show up.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, context.getHandler())) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (!key || key.length > 255) {
      throw new AppError(
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        400,
        'An Idempotency-Key header (1-255 characters) is required for this request',
      );
    }

    // ponytail: scope has no user yet; it gains the authenticated user id in step 1.10.
    // Route pattern (/bookings/:id), typed `any` by Express; falls back to the concrete path.
    const route = req.route as { path?: string } | undefined;
    const scope = `anonymous ${req.method} ${route?.path ?? req.path}`;
    const requestHash = createHash('sha256')
      .update(`${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? null)}`)
      .digest('hex');
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === 'POST' ? 201 : 200);

    return from(this.claim(scope, key, requestHash)).pipe(
      mergeMap((replay) => {
        if (replay) {
          res.status(replay.status).setHeader('Idempotent-Replayed', 'true');
          return of(replay.body);
        }
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await this.complete(scope, key, status, body);
            return body;
          }),
          // The handler failed, so its transaction rolled back: free the key for a retry.
          // A failed release must not hide the original error.
          catchError((err: unknown) =>
            from(this.release(scope, key).catch(() => undefined)).pipe(
              mergeMap(() => throwError(() => err)),
            ),
          ),
        );
      }),
    );
  }

  /**
   * Inserts an in_progress row, or takes over an expired one. Returns the stored response to
   * replay, or null when this request owns the key and should run the handler.
   */
  private async claim(
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<{ status: number; body: unknown } | null> {
    const fresh = {
      scope,
      key,
      requestHash,
      status: 'in_progress' as const,
      responseStatus: null,
      responseBody: null,
      createdAt: sql`now()`,
      expiresAt: sql`now() + make_interval(hours => ${TTL_HOURS})`,
    };
    const claimed = await this.db
      .insert(idempotencyKey)
      .values(fresh)
      .onConflictDoUpdate({
        target: [idempotencyKey.scope, idempotencyKey.key],
        set: fresh,
        setWhere: lt(idempotencyKey.expiresAt, sql`now()`),
      })
      .returning({ id: idempotencyKey.id });
    if (claimed.length === 1) return null;

    const [existing] = await this.db
      .select()
      .from(idempotencyKey)
      .where(and(eq(idempotencyKey.scope, scope), eq(idempotencyKey.key, key)));
    if (!existing) throw new Error('idempotency row vanished between claim and read');

    if (existing.requestHash !== requestHash) {
      throw new AppError(
        ErrorCode.IDEMPOTENCY_KEY_MISMATCH,
        422,
        'This Idempotency-Key was already used with a different request',
      );
    }
    if (existing.status === 'in_progress' || existing.responseStatus === null) {
      throw new AppError(
        ErrorCode.IDEMPOTENCY_IN_PROGRESS,
        409,
        'A request with this Idempotency-Key is still being processed',
      );
    }
    return { status: existing.responseStatus, body: existing.responseBody };
  }

  private async complete(scope: string, key: string, status: number, body: unknown): Promise<void> {
    await this.db
      .update(idempotencyKey)
      .set({ status: 'completed', responseStatus: status, responseBody: body ?? null })
      .where(and(eq(idempotencyKey.scope, scope), eq(idempotencyKey.key, key)));
  }

  private async release(scope: string, key: string): Promise<void> {
    await this.db
      .delete(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.scope, scope),
          eq(idempotencyKey.key, key),
          eq(idempotencyKey.status, 'in_progress'),
        ),
      );
  }
}
