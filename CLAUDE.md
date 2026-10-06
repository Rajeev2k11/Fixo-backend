# FIXO backend — instructions for Claude

FIXO is a home-services marketplace (cleaning, AC servicing, plumbing, mechanics) launching in Lucknow, India.
The full design is in `docs/spec/fixo-architecture-spec.pdf` (sections A–Z). That spec is the source of truth.
If code and spec disagree, stop and tell me. Do not silently pick one.

I am a full-stack developer (React, Next.js, Node/Express, TypeScript) learning backend system design while building this.
After each step, explain briefly WHY you made the key design choices, not just what you changed.

## Stack (do not change without asking)

- Monorepo: pnpm workspaces + Turborepo. Node 20+. TypeScript `strict: true` everywhere.
- API: NestJS in `apps/api` (modular monolith). Background worker: `apps/jobs` (same code, separate entry point).
- DB: PostgreSQL 16 + PostGIS. ORM: Drizzle (SQL-first). Migrations are committed, never edited after merge.
- Redis 7 + BullMQ for queues, delayed jobs and locks. Socket.IO with Redis adapter for realtime (later phase).
- Validation: Zod schemas in `packages/contracts`, shared by API and mobile app.
- Tests: Vitest. Integration tests use a real Postgres + Redis (Testcontainers or the docker-compose services). Never mock the database for money, locks or state transitions.
- Logging: pino, JSON, with requestId. Never log phone numbers in full, OTPs, tokens, KYC data or bank details.
- Local infra: `docker-compose.yml` (postgis/postgis:16, redis:7).

## Folder layout

Follow spec section Z. Every backend module looks like:

```
modules/<name>/
  <name>.controller.ts     routes, guards, validation only
  <name>.service.ts        use cases, opens transactions
  <name>.repository.ts     the ONLY file that touches this module's tables
  domain/<name>.state-machine.ts   allowed transitions (pure, no framework imports)
  domain/<name>.rules.ts           pure business rules
  dto/  events/  <name>.spec.ts
```

## Non-negotiable rules

1. **Module boundaries.** A module never imports another module's internals or writes its tables. Use its public service or react to its events. Enforce with lint rules.
2. **Server owns the truth.** Never accept price, total, commission, earnings, role, KYC status or payment status from a client. Reject unknown fields.
3. **State machines.** Booking, lead, quote, job and payment each have their own status and their own `*_status_history` table. Status changes only through the owning service's `transition()`, using compare-and-set on a `version` column. Every change writes history and an outbox event in the same transaction.
4. **Transactions + outbox.** Any write that changes money or a lead/booking/job state runs in one DB transaction and writes an `outbox_event` row in that same transaction. Side effects (push, SMS, matching) run in background jobs, never inside the request.
5. **Idempotency.** Create-booking, respond-to-lead, accept-quote, create-payment, refund and payout require an `Idempotency-Key` header. Event consumers record processed event IDs.
6. **Money.** Integer paise only, never floats. Ledger is append-only and double-entry (debits = credits per transaction). Fix mistakes with reversing entries. Never UPDATE or DELETE ledger rows.
7. **Configuration, not constants.** Fees, commission, lead cap, radius, wave size, timeouts and cancellation rules live in versioned config tables. Bookings store a snapshot of rule versions. No business numbers hard-coded in code.
8. **Timers.** Deadlines are columns (`expires_at`) with partial indexes; a `FOR UPDATE SKIP LOCKED` sweeper is the safety net; BullMQ delayed jobs are the fast path.
9. **Scale-ready data.** UUID primary keys, UTC timestamps, `city_id` on every operational row, partial indexes on open statuses.
10. **Errors.** One shape: `{ error: { code, message, details, requestId } }` with stable machine codes (e.g. `LEAD_FILLED`, `QUOTE_EXPIRED`, `OUT_OF_SERVICE_AREA`).
11. **External services behind adapters.** SMS, WhatsApp, push, payments, maps, storage each get an interface plus a `Fake` implementation used in dev and tests (e.g. FakeSms prints the OTP to the console). Real providers: MSG91, Meta WhatsApp Cloud API, FCM, Razorpay, Google Maps, Cloudflare R2.
12. **Security.** Secrets only from env (validated at boot with Zod). Rate limits on OTP and auth. Hashed refresh tokens bound to a device. Audit row for every admin action on money, rules, KYC or account status.

## Open business decisions

The spec lists OBD-1 to OBD-15 as undecided. Do NOT invent answers. Build them as configuration and ask me.
Record every decision I make in `docs/decisions.md` (date, decision, reason).

## How to work with me

- Work one phase step at a time. Before writing code for a new step, propose a short plan and wait for my OK.
- Keep changes small enough that I can review the diff.
- After each step: run lint, typecheck and tests; show me the results; summarise what changed and why; suggest a commit message.
- If a test fails, fix the cause. Never delete or weaken a test to make it pass.
- Do not add dependencies without saying why.
- Never commit `.env` files or secrets.

## Commands

- `docker compose up -d` — start Postgres + Redis
- `pnpm install`
- `pnpm dev` — run API and jobs in watch mode
- `pnpm test` / `pnpm test:integration`
- `pnpm lint` / `pnpm typecheck`
- `pnpm build` — compile all packages (Turborepo, cached)
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm db:generate` / `pnpm db:migrate` (added in Phase 1 step 1.3)

Toolchain notes: all packages are ESM (`"type": "module"`, NestJS 12 is ESM-only), so relative
imports use `.js` extensions. TypeScript is pinned to 6.x because typescript-eslint does not yet
support TS 7.

(Update this section as scripts are added.)
