# Phase 1 exit report — foundations

**Date:** 2026-10-17 · **Spec:** "Implementation phases", Phase 1 · **Status:** exit criteria met

Phase 1 scope (spec): monorepo, database, migrations, auth, roles, config registry, audit,
idempotency, outbox. Exit criteria: login works for all three roles; RBAC tests pass; audit rows
written. Each phase also ends with tests, an authorization review, a database consistency check,
a duplicate-request check and this written report.

---

## 1. Exit criteria

| Criterion | Result | Evidence |
|---|---|---|
| Login works for all three roles | Met | Customer and worker: phone OTP, then a JWT access token and a rotating refresh token (`auth-otp.int-spec`, `auth-session.int-spec`). Admin: email + password, then mandatory TOTP MFA, then a cookie-based session (`admin-auth.int-spec`). All three were also run by hand against the dev server. |
| RBAC tests pass | Met | `rbac.int-spec`: every admin route × all 5 admin roles + customer + worker (42 cases), plus per-key config policy and maker-checker over HTTP. A route deliberately opened to the wrong role made the matrix fail. |
| Audit rows written | Met | Config propose/approve/reject/activate, admin created, admin roles changed and account status changes all write `audit_log` in the same transaction as the change (`config`, `users`, `rbac` and `admin-auth` integration specs). The table rejects UPDATE, DELETE and TRUNCATE at the database level (`audit.int-spec`). |

## 2. Phase checks

### Tests
| Suite | Tests | Needs |
|---|---|---|
| Unit + e2e (`pnpm test`) | 87 (api 65, contracts 10, config 12) | nothing (DB and Redis point at closed ports) |
| Integration (`pnpm test:integration`) | 131 in 11 files | `docker compose up -d --wait` |

Integration tests use a real Postgres and Redis on a throwaway database and Redis key prefix per
run. They pass in any order: verified with `vitest --sequence.shuffle` (files and tests shuffled),
repeatedly. Lint, typecheck, build and Prettier are clean.

### Authorization review
Every route, and who may call it. The list is enforced by `test/docs.e2e-spec.ts`: any route not
on the public list must answer 401 without a token, so a route cannot be left open by mistake.

| Route | Access |
|---|---|
| `GET /v1/health`, `GET /v1/docs`, `GET /v1/docs/openapi.json` | Public (docs only outside production) |
| `POST /v1/auth/otp/request`, `/otp/verify`, `/refresh`, `/logout` | Public; rate limited; refresh is bound to the device |
| `POST /v1/admin/auth/login`, `/mfa` | Public; lockout and MFA attempt limits |
| `POST /v1/admin/auth/refresh`, `/logout` | httpOnly refresh cookie + double-submit CSRF header |
| `GET /v1/admin/config/rules` | super_admin, operations, finance |
| `POST /v1/admin/config/rules` | super_admin, operations; then per key: `revenue.*` and `auth.*` super_admin only |
| `POST /v1/admin/config/rules/{id}/approve` | finance (per key policy), and never the proposer |
| `POST /v1/admin/config/rules/{id}/reject` | approvers, or the proposer withdrawing |
| `POST /v1/admin/admins`, `PUT /v1/admin/admins/{userId}/roles` | super_admin; never your own roles |

Other properties checked by tests: customer and worker tokens never reach admin routes; a logout,
revocation or suspension takes effect on the next request; MFA tokens and access tokens are not
interchangeable (different JWT audiences); admin roles are re-read on every request.

### Database consistency
Integrity is enforced by the database, not only by code:

| Guarantee | Mechanism |
|---|---|
| UUID `id` primary key, timestamptz only, `city_id` on operational tables | `schema.int-spec` convention checks (exceptions listed explicitly in the test) |
| Audit history can never change | Triggers reject UPDATE/DELETE/TRUNCATE on `audit_log`; non-empty `reason` CHECK |
| One approved config value per key, scope and moment | `btree_gist` exclusion constraint on `config_rule` |
| Maker ≠ checker for config | CHECK `approved_by <> created_by`, plus the service check |
| One account per phone / email | UNIQUE (`type`, `value`) on `auth_identity`; advisory lock for concurrent sign-ups |
| Valid statuses only | CHECK constraints on user, config, idempotency and session status columns |
| Actors exist | Foreign keys from `audit_log` and `config_rule` actors to `user` |

Seeded reference data (Lucknow, admin roles, launch config values) comes from migrations, so every
environment has identical rows. 17 migrations, none edited after commit.

### Duplicate-request check
| Duplicate | Outcome | Test |
|---|---|---|
| Client retries an `@Idempotent()` request | Stored response replayed; handler runs once (20 concurrent retries tested) | `idempotency.int-spec` |
| Two users send the same Idempotency-Key | Scoped per user: no collision | `idempotency.int-spec` |
| Same key, different body | 422 `IDEMPOTENCY_KEY_MISMATCH` | `idempotency.int-spec` |
| 10 concurrent first logins for one phone | Exactly one user created | `users.int-spec` |
| Two outbox relays at once | Each event published exactly once (`FOR UPDATE SKIP LOCKED`) | `outbox.int-spec` |
| Event delivered twice | Consumer effect applied once (`processed_event` in the same transaction) | `outbox.int-spec`, `auth-session.int-spec` |
| Refresh token presented twice | Treated as theft; whole session revoked | `auth-session.int-spec` |
| OTP or TOTP code reused | Rejected (single-use challenge; last accepted TOTP step stored) | `auth-otp.int-spec`, `admin-auth.int-spec` |
| Two admins change one account at once | One wins; the other gets `CONCURRENT_UPDATE` (version compare-and-set) | `users.int-spec` |

Mobile responsiveness: not applicable (backend only; the frontends are built separately).

## 3. What was built

| Step | Delivered |
|---|---|
| 1.1 | pnpm + Turborepo monorepo, strict TypeScript, ESLint, Prettier, Vitest, NestJS API and jobs entry, docker-compose (PostGIS 16, Redis 7) |
| 1.2 | Zod env validation, pino JSON logs with request ids and redaction, one error shape, strict request validation |
| 1.3 | Drizzle and migrations, geography reference tables with Lucknow seed, integration test harness |
| 1.4 | Transactional outbox, relay to BullMQ, idempotent consumers, jobs process reusing API code |
| 1.5 | `Idempotency-Key` handling |
| 1.6 | Append-only audit log |
| 1.7 | Versioned config registry (precedence, effective dates, maker-checker) |
| 1.8 | Users, identities, role profiles, account status machine |
| 1.9 | OTP login with hashed codes, queued SMS, Redis rate limits |
| 1.10 | Sessions: JWT access tokens, rotating device-bound refresh tokens, secure-by-default guard, first event consumer |
| 1.11 | Admin login: password, mandatory TOTP MFA, cookie session with CSRF protection, admin CLI |
| 1.12 | RBAC, per-key config policy, admin endpoints, module-boundary lint rule |
| 1.13 | Committed `packages/contracts/openapi.json`, authorization-surface test, this report |

Also: Swagger UI at `/v1/docs` (dev only), generated from the same Zod schemas the API validates
with; a test fails if any route is undocumented or the committed spec is stale.

## 4. Decisions taken during Phase 1
All recorded in `docs/decisions.md` with date and reason: OBD-1, 1a, 3, 3a, 7, 11, 12, 13, 15;
SPEC-1 (config precedence), SPEC-2 (maker-checker), SPEC-3 (admin identity), SPEC-4 (one config
table); TOOL-1 (Node 22.12); OTP-1 (OTP limits); AUTH-1 (app sessions); AUTH-2 (admin login).

## 5. Deviations from the spec
| Area | Spec | Built | Why / where recorded |
|---|---|---|---|
| Config tables | Five tables (§K) | One versioned `config_rule` table | SPEC-4 |
| Subscriptions | V2 (§U) | Planned before the free period ends | OBD-1 |
| Customer app | Web/PWA first (OBD-11 recommendation) | Native apps for both | OBD-11 |
| Node version | Not fixed; CLAUDE.md said 20+ | 22.12+ | TOOL-1 |
| Permissions | "From roles" (§K), no table specified | Role → permission rules in code; role assignments in the database | Reviewed in git; spec does not require permission tables |

Choices that differ from the Phase 1 plan (not the spec): scrypt instead of argon2 (no native
add-on; OWASP-approved), docker-compose services instead of Testcontainers for integration tests,
TypeScript pinned to 6.x (typescript-eslint does not support 7 yet).

## 6. Known shortcuts (each marked `ponytail:` in code with its upgrade path)
| Where | Shortcut | Upgrade when |
|---|---|---|
| Outbox relay | Polls every 500 ms when idle | Event latency matters → LISTEN/NOTIFY |
| Rate limiter | Fixed window (2× burst possible at a boundary) | Abused → sliding window |
| Idempotency | 24 h window, no cleanup job; response stored after the handler's transaction (a crash between leaves a 409, never a duplicate) | Table grows → sweeper; 409s seen → store inside the handler's transaction |
| Sessions | Two indexed lookups per request; no refresh grace period | Hot → Redis cache; real apps race refreshes → short grace window |
| OTP limits | IP is the socket address | **Before deploy**: set Express `trust proxy` behind the load balancer |
| Config list | Fixed 200-row page | Admin UI needs more → cursor pagination |
| Integration tests | Files run sequentially on one database | Suite gets slow → database per file |

## 7. Before production (not Phase 1 scope, tracked here so they are not lost)
- Real SMS provider (MSG91) behind the existing `SmsSender` adapter; production refuses to boot with the fake.
- `trust proxy` configuration (see above); secrets from a managed vault; least-privilege DB role without UPDATE/DELETE on `audit_log`.
- Admin password change and MFA reset/recovery (spec §Y module 21) — Phase 9.
- `X-Powered-By` header removal and general hardening — Phase 11.

## 8. Open items to settle before Phase 2
From the spec review (see the planning notes): the worker account status machine and how it relates
to KYC and skill verification records must be defined before Phase 2 starts. Remaining state-machine
gaps (lead, quote, booking, payment) are due before Phases 4–7.

## 9. How to verify
```bash
docker compose up -d --wait
pnpm install && pnpm db:migrate
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
pnpm dev   # API on :3000, Swagger at http://localhost:3000/v1/docs
```
