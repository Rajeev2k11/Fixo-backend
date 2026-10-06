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

## Deferred (to be decided before the phase noted)
- OBD-2 Lead-fee timing and refunds — Phase 5 (moot while fees are 0).
- OBD-4 Mandatory in-app quote approval — Phase 6.
- OBD-5 Collecting FIXO's share on cash jobs — Phase 7 (moot until commission).
- OBD-6 What a worker sees and when — Phase 5.
- OBD-8 Cancellation windows, fees, penalties — Phase 6.
- OBD-9 Payment timing — Phase 7.
- OBD-10 Visibility of worker ratings of customers — Phase 8.
- OBD-14 Service guarantee — Phase 8.
