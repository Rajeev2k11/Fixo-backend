# Decision log

Business and design decisions for FIXO, made by the product owner.
The spec (`docs/spec/fixo-architecture-spec.pdf`) is the source of truth; entries here override it
where they say so. Every number referred to below lives in versioned configuration, not in code.

Format: date · decision · reason · spec impact.

---

## 2026-10-06 — Launch decisions (pre-Phase 1)

### OBD-1 — Revenue model
- **Decision:** Workers use FIXO **free** at launch for a **platform-wide** period. After that, a
  **monthly subscription** fee. After about one year, switch to **commission**.
- **Reason:** Build worker supply first; monetise once there is steady lead volume.
- **Spec impact:**
  - The free period is one dated revenue rule (lead fee 0, commission 0). Each later stage is a new
    rule version in the same revenue engine.
  - **Deviates from spec §U**, which lists subscriptions as V2. Subscriptions are not in the MVP
    build, but they must be ready before the free period ends.

### OBD-1a — Free period scope
- **Decision:** Platform-wide (everyone free until a set date), **not** a per-worker trial.
- **Reason:** Pure configuration; no trial or plan tables needed in the MVP.

### OBD-3 — Lead cap and selection
- **Decision:** **Cap of 1. FIXO assigns the best-ranked worker.**
- **Reason:** The customer gets one vetted worker instead of several calls.
- **Spec impact:**
  - Leads are offered one at a time in rank order (wave size 1). The next-ranked worker is offered
    when the current one declines or the lead window expires.
  - The lead window directly determines how long the customer waits. Numbers (window length, maximum
    offers) are to be decided in Phase 4/5.
  - Customer screens C10/C11 show one worker rather than a comparison.

### OBD-3a — Emergency bookings under cap 1
- **Decision:** Emergency bookings **notify all eligible workers** in the emergency radius at once.
  The **first to accept** gets the lead.
- **Reason:** Speed matters more than ranking in an emergency. The lead-pool row lock makes
  first-to-accept safe under concurrency. Normal bookings stay best-ranked-first.

### OBD-7 — Booking fee and gateway fees
- **Decision:** **No customer booking fee** at launch. **FIXO absorbs gateway fees.**
- **Reason:** Conversion matters more than fee revenue at launch.
- **Spec impact:** The booking-fee rule exists in config, set to 0. GST and invoicing still need
  confirmation from an accountant.

### OBD-11 — Client apps
- **Decision:** **Native apps (Expo) for both customers and workers** from day one. The admin panel is
  a web app.
- **Reason:** Owner preference.
- **Spec impact:**
  - **Deviates from the spec's recommendation** (customer web/PWA first).
  - Customer and worker auth uses bearer tokens only. Admin web uses an httpOnly cookie + CSRF.

### OBD-12 — Workers with KYC verified but skill not yet verified
- **Decision:** **Probation.** These workers get limited leads in one category with trial-job
  feedback, then full skill verification.
- **Reason:** Helps worker supply at launch.
- **Spec impact:** With cap 1 and best-ranked-first, probation workers would almost never rank first.
  The §Q.5 exploration slot must be enabled for probation workers. Limits are config.

### OBD-13 — KYC handling
- **Decision:** Verify through a **licensed KYC provider**. Store only the result and a **masked
  reference**, with manual admin review on top.
- **Reason:** Avoids storing full identity numbers.
- **Spec impact:**
  - The provider is to be chosen later; it sits behind a `KycVerifier` adapter with a Fake
    implementation.
  - Legal review is still required before launch.

### OBD-15 — Emergency service
- **Decision:** Emergency service in **limited hours**, with a **separate emergency fee**, a configured
  share to the worker, and a larger radius.
- **Reason:** Spec recommendation accepted.
- **Spec impact:** Hours, fee and split are config.

### SPEC-1 — Config scope precedence (resolves §A vs §P conflict)
- **Decision:** When several rules match, **catalogue specificity wins first** (problem > subcategory >
  category > any), **then geography** (zone > city > global).
- **Reason:** Matches the pricing order in §P.
- **Spec impact:**
  - Settings with no catalogue dimension (lead cap, radius) resolve by geography only.
  - Worker plan as a scope dimension is deferred until subscriptions exist.

### SPEC-2 — Approval of revenue-rule changes (resolves §M vs §Y conflict)
- **Decision:** **Maker-checker** for revenue rules. A super admin drafts; a different admin with the
  finance role approves before the rule takes effect.
- **Reason:** Revenue rules move money. Two people protect against mistakes and abuse.
- **Spec impact:** Other rule types (pricing, marketplace, cancellation) are single-step by OPS/SA,
  with a mandatory reason and an audit row.

### SPEC-3 — Admin identity
- **Decision:** Admins live in the same `user` table as customers and workers, with linked auth
  identities (phone + OTP, email + password + MFA).
- **Reason:** Matches the §M "user with linked auth methods" model. A staff member can also be a
  customer.

---

## 2026-10-13 — Toolchain

### TOOL-1 — Minimum Node version raised to 22.12
- **Decision:** `engines.node` is `>=22.12` (was "Node 20+"); `.nvmrc` 22; `@types/node` ^22.
- **Reason:** Vitest 5 requires Node ^22.12, so tests could not run on Node 20. Node 20 reached
  end-of-life in April 2026 and no longer receives security fixes. Node 22 is LTS until April 2027.
- **Spec impact:** None (the spec does not fix a Node version). CLAUDE.md stack line updated.

### SPEC-4 — One generic config table instead of five (deviates from spec §K)
- **Decision:** A single versioned `config_rule` table holds every configurable business value,
  keyed by a namespaced key (`revenue.lead_fee`, `matching.lead_cap`, ...), with scope columns,
  effective dates, maker-checker status and a jsonb value validated by a per-key Zod schema.
- **Reason:** One resolver, one approval flow and one overlap constraint instead of five copies.
  A rule type moves to its own typed table later only if it needs relational queries.
- **Spec impact:** Replaces §K's `pricing_rule`, `revenue_rule`, `cancellation_rule`,
  `marketplace_setting` and `ranking_weight` with keys in one table. Versioning, scope,
  effective_from/to and created_by from §K are kept.

## 2026-10-14 — Auth

### OTP-1 — Starting values for OTP security (seeded as config, tunable by admins)
- **Decision:** 6-digit code; expires in 5 minutes; 5 wrong attempts, then a new OTP is needed.
  Requests per phone: 3 per 10 minutes (spec §L). Per IP: 30 per 10 minutes. Per device:
  5 per 10 minutes. Resend cooldown 30 seconds, doubling with each resend in the window.
- **Reason:** Spec §L gives only the per-phone limit. The per-IP limit is generous because Indian
  mobile carriers put many users behind one shared IP (CGNAT).
- **Spec impact:** Fills values §L and §M leave open. Stored as `auth.otp.*` config keys.

### AUTH-1 — Session lifetime on the mobile apps
- **Decision:** Access token 15 minutes (spec §M). Refresh session: 30 days idle (each refresh
  extends it), 90 days maximum, then the user logs in with OTP again.
- **Reason:** Marketplace apps are opened irregularly; workers should rarely need a new OTP,
  but a lost device does not stay logged in forever.
- **Spec impact:** Fills the session lifetime §M leaves open. Stored as `auth.access_token_ttl_seconds`,
  `auth.session.idle_days` and `auth.session.max_days`.

### AUTH-2 — Admin login limits
- **Decision:** Admin sessions end after 30 minutes idle or 12 hours at most (one working day).
  Passwords: at least 12 characters, no composition rules (NIST 800-63B). 5 wrong passwords lock
  the account for 15 minutes. 5 wrong MFA codes end a login attempt. Access token 15 minutes.
- **Reason:** Spec §M asks for shorter admin sessions and lockout without giving numbers; admin
  accounts can move money and change rules, so they get much tighter limits than the apps.
- **Spec impact:** Fills §M. Stored as `auth.admin.*` config keys.

---

## 2026-10-17 — Phase 2 (worker onboarding)

### PHASE-1 — Split worker onboarding across Phases 2 and 3
- **Decision:** Phase 2 builds the worker profile, KYC, agreement, private document storage and the
  admin verification queue up to VERIFIED. Areas covered, services and per-subcategory skill
  verification move to Phase 3, after geography and the service catalogue exist.
- **Reason:** Spec Phase 2 needs areas and subcategories that only Phase 3 creates, and Phase 3's
  seed data must be real reference data from the owner. Splitting avoids blocking and rework.
- **Spec impact:** Phase 2 exit ("full onboarding to VERIFIED through the admin queue") is met with
  identity verification; worker leads still require skill verification (Phase 3) per §Q.

### WORKER-1 — Worker status machine
- **Decision:** REGISTERED → (submit) KYC_PENDING → (provider result) UNDER_REVIEW →
  VERIFIED / REJECTED / back to REGISTERED (resubmission requested, with reason).
  VERIFIED → UNDER_REVIEW (KYC expired or re-review). VERIFIED ⇄ SUSPENDED (worker-level).
  REJECTED → REGISTERED only when an admin reopens it.
- **Reason:** Fills the transitions §C, §D and edge cases 15–16 imply but do not list.
- **Spec impact:** Worker SUSPENDED stops worker activity only; the account status from Phase 1
  (active/suspended/blocked) still restricts the whole account, including customer use.

### KYC-1 — Identity documents at launch
- **Decision:** Aadhaar, verified through the licensed KYC provider (OBD-13), plus a selfie.
  Stored: provider result, masked Aadhaar (XXXX XXXX 1234) and name; never the full number or an
  ID image. The selfie is stored in private storage for the admin face check.
- **Reason:** Aadhaar is the most common ID among workers; storing only masked references limits
  legal exposure (legal review still required before launch, OBD-13).
- **Spec impact:** Answers "which documents" in OBD-13. Category licences belong to skill
  verification (Phase 3). PAN only if payouts or TDS later need it.

### KYC-2 — KYC re-verification interval
- **Decision:** A verified worker's KYC expires after 24 months, with warnings 30 and 7 days before.
  On expiry the worker moves to UNDER_REVIEW and receives no new leads; active jobs continue.
- **Reason:** Catches account handovers without frequent friction.
- **Spec impact:** Fills the expiry period edge case 15 leaves open. Stored as config.

### BANK-1 — Bank or UPI details only before the first payout
- **Decision:** Workers are not asked for bank/UPI details during onboarding; they give them before
  their first payout (stored encrypted, shown masked).
- **Reason:** Faster onboarding during the free launch period, when there are no payouts yet.
- **Spec impact:** **Deviates from spec §C.5**, which puts bank/UPI in onboarding KYC. Built with
  payouts (Phase 7).

---

## Deferred (to be decided before the phase noted)
- OBD-2 Lead-fee timing and refunds — Phase 5 (moot while fees are 0).
- OBD-4 Mandatory in-app quote approval — Phase 6.
- OBD-5 Collecting FIXO's share on cash jobs — Phase 7 (moot until commission).
- OBD-6 What a worker sees and when — Phase 5.
- OBD-8 Cancellation windows, fees, penalties — Phase 6.
- OBD-9 Payment timing — Phase 7.
- OBD-10 Visibility of worker ratings of customers — Phase 8.
- OBD-14 Service guarantee — Phase 8.
