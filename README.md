# ICH GCP Training & Certification Platform

A production-grade platform for structured **ICH GCP** (Good Clinical Practice) training,
blueprint-driven assessment, and verifiable training certificates for pharmaceutical,
CRO, clinical-research, investigator-site, sponsor, CRA, CRC and QA professionals.

> **Certificate scope.** The certificate issued by this platform attests to completion
> of this training programme against its configured passing criteria. It is **not** a
> regulatory accreditation or an official ICH certification unless such accreditation is
> separately established.

---

## Status — Stage 4 (Admin Content Management)

This repository is being built in controlled stages. **Stage 4 delivers the
secure admin/content-author API** for all 8 content entities — training programs,
levels, modules, lessons, learning objectives, sources, case studies and
observations: CRUD, the DRAFT→REVIEW→APPROVED→PUBLISHED→ARCHIVED workflow,
manual ordering, activation/deactivation, a version counter, search/filter/
pagination, validation and per-action role-based authorization. No AI
generation, and no learner-facing content delivery yet — see
[`docs`](#stage-roadmap) below for what's still ahead.

---

## Architecture

```
gcp-training-platform (pnpm + Turborepo monorepo)
├── apps/
│   ├── api/      NestJS REST API · Prisma · PostgreSQL      (port 3001, prefix /api)
│   └── web/      Next.js (App Router) · TypeScript · Tailwind (port 3000)
├── packages/
│   ├── shared/         @gcp/shared — enums + zod API contracts (API ⇄ web)
│   ├── eslint-config/  @gcp/eslint-config — shared flat ESLint config
│   └── tsconfig/       @gcp/tsconfig — base / nestjs / nextjs / library presets
└── infra/
    └── docker-compose.yml   PostgreSQL 16 + Adminer (local dev only)
```

**Key decisions:** pnpm workspaces + Turborepo; Prisma for schema, migrations and
type-safe access; database-level constraints (CHECK, FK `ON DELETE`, append-only
audit-log triggers) expressed in migration SQL; strict TypeScript everywhere;
shared runtime contracts validated with zod on both sides of the wire.

---

## Prerequisites

| Tool       | Version         | Notes                                                         |
| ---------- | --------------- | ------------------------------------------------------------- |
| Node.js    | ≥ 20.11         | `.nvmrc` pins 20.11.0                                         |
| pnpm       | 9.15.4          | `corepack enable && corepack prepare pnpm@9.15.4 --activate`  |
| PostgreSQL | 16+ (18 tested) | via `infra/docker-compose.yml`, **or** a native local install |

---

## Getting started

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 2b. Generate real local secrets for JWT_ACCESS_SECRET and OTP_PEPPER in
#     apps/api/.env (the .env.example placeholders are NOT safe to keep):
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # -> JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # -> OTP_PEPPER

# 3. Provide a PostgreSQL 16+ database — either:
pnpm db:up                                    # (a) Docker: postgres + adminer on :8080
#   -- or --, if you don't have Docker: create a dedicated low-privilege role/db on a
#   native PostgreSQL install and point apps/api/.env DATABASE_URL at it, e.g.:
#     createuser -P gcp                       # set password 'gcp_local_dev_only' to match .env.example
#     createdb -O gcp gcp_training
#   `prisma migrate dev` (used for schema changes, not `deploy`) additionally needs
#   CREATEDB on that role for its shadow database: ALTER ROLE gcp CREATEDB;

# 4. Apply the database migrations
pnpm --filter @gcp/api prisma:deploy

# 5. Seed baseline RBAC (roles + a starter permission set — no business data)
pnpm --filter @gcp/api db:seed

# 6. Run everything in dev
pnpm dev              # api → http://localhost:3001/api , web → http://localhost:3000
```

---

## Quality gates

Run individually or all via Turborepo:

```bash
pnpm lint         # ESLint (flat config), zero warnings allowed
pnpm typecheck    # tsc --noEmit in every package
pnpm test         # unit tests (Vitest for web/shared, Jest for api)
pnpm build        # next build + nest build
pnpm format:check # Prettier

# Requires a running database + applied migrations:
pnpm --filter @gcp/api test:e2e   # Supertest against the real HTTP + DB stack
```

CI (`.github/workflows/ci.yml`) runs install → migrate → lint → typecheck → test →
build → api e2e against an ephemeral PostgreSQL service on every push and PR to `main`.

---

## Manual verification (Stage 1)

```bash
pnpm db:up
pnpm --filter @gcp/api prisma:deploy
pnpm --filter @gcp/api prisma:status         # expect: "Database schema is up to date!"
pnpm dev

curl -s http://localhost:3001/api/health     # {"status":"ok",...,"dependencies":{"database":"up"}}
```

- Open <http://localhost:3000> — landing page renders; the **Platform status** card
  shows **Operational** (proves web → API → DB → shared-contract validation).
- Open <http://localhost:8080> (Adminer, server `postgres`, db `gcp_training`) —
  confirm `users` and `audit_log` tables with their indexes, the `audit_log` → `users`
  foreign key, and the `users_email_shape_chk` / append-only triggers.
- Config fail-fast: blank `DATABASE_URL` in `apps/api/.env`, then
  `pnpm --filter @gcp/api dev` → the API refuses to boot with a clear message.

---

## Manual verification (Stage 2)

```bash
pnpm --filter @gcp/api prisma:deploy    # applies all 3 migrations
pnpm --filter @gcp/api prisma:status    # expect: "Database schema is up to date!"
pnpm --filter @gcp/api db:seed          # seeds 4 baseline roles + 9 permissions (no business data)
```

- `psql`/Adminer: confirm 25 domain tables exist (`\dt`) alongside `users` and `audit_log`.
- Confirm referential integrity: inserting an `exam_attempts` row with a
  non-existent `user_id`/`blueprint_id`/`level_id` is rejected with a foreign-key
  violation.
- Confirm the exam-integrity constraint: two `IN_PROGRESS` rows in `exam_attempts`
  for the same `user_id` — the second insert is rejected (partial unique index
  `exam_attempts_one_active_per_user`).
- Confirm the one-default-blueprint-per-level partial unique index
  (`exam_blueprints_one_default_per_level`).
- Confirm CHECK constraints reject an out-of-range `passing_score_percent` (>100)
  on `exam_blueprints`.
- Confirm `audit_log` is still append-only after the new migrations (`UPDATE`/`DELETE`
  raise `insufficient_privilege`).
- `pnpm --filter @gcp/api test:e2e` — real HTTP + real Prisma connection against
  the database (this is the "backend database connection test").

---

## Manual verification (Stage 3)

```bash
pnpm --filter @gcp/api prisma:deploy    # applies all migrations
pnpm --filter @gcp/api db:seed          # ensures LEARNER/ADMIN roles exist
pnpm dev
```

- `POST /api/auth/register` with a fresh email → 200; the OTP is logged to the API
  console (dev mail transport) — never returned in the response body.
- `POST /api/auth/register` again with the **same, now-active** email → 409
  `EMAIL_ALREADY_REGISTERED`.
- `POST /api/auth/verify-email` with a wrong code → 400 `OTP_INVALID`; 5 wrong
  codes in a row → 429 `OTP_MAX_ATTEMPTS_EXCEEDED`.
- `POST /api/auth/verify-email` with the correct code → 200 with an
  `emailVerificationToken`; `POST /api/auth/set-password` with it → 200.
- `POST /api/auth/login` with the wrong password → 401 `INVALID_CREDENTIALS`;
  with the right one → 200 with an `accessToken` and a `Set-Cookie: refresh_token=…
HttpOnly` header.
- `GET /api/auth/me` with no `Authorization` header → 401; with `Bearer
<accessToken>` → 200 with `{ id, email, roles: ["LEARNER"], emailVerified: true,
status: "ACTIVE" }`.
- `GET /api/auth/admin-check` as a LEARNER → 403 (RBAC foundation working).
- Send 11 rapid requests to `POST /api/auth/login` from the same client → the
  11th returns 429 (rate limiting on sensitive auth operations).
- `pnpm --filter @gcp/api test:e2e` — full flow above, run for real against the
  database (`auth.e2e-spec.ts`, `auth-rate-limit.e2e-spec.ts`).

---

## Manual verification (Stage 4)

All routes live under `/api/admin/**`, one controller per resource
(`programs`, `levels`, `modules`, `lessons`, `learning-objectives`, `sources`,
`case-studies`, `observations`). Every route requires authentication; reads need
`CONTENT_AUTHOR`/`REVIEWER`/`ADMIN`, writes need `CONTENT_AUTHOR`/`ADMIN`, and
workflow actions are individually role-gated (see table below).

```bash
pnpm dev
# log in as a CONTENT_AUTHOR/REVIEWER/ADMIN (Stage 3 flow, or seed one directly)

# hierarchy
curl -X POST http://localhost:3001/api/admin/programs -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"slug":"ich-gcp","title":"ICH GCP"}'
curl -X POST http://localhost:3001/api/admin/levels -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"programId":"<id>","code":"FOUNDATION","name":"Foundation"}'
curl -X POST http://localhost:3001/api/admin/levels/reorder -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"parentId":"<programId>","orderedIds":["<id1>","<id2>"]}'

# workflow: DRAFT -> REVIEW -> APPROVED -> PUBLISHED -> ARCHIVED -> RESTORE
curl -X PATCH http://localhost:3001/api/admin/levels/<id>/status -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"action":"SUBMIT_FOR_REVIEW"}'
```

| Workflow action     | Allowed roles         | Transition           |
| ------------------- | --------------------- | -------------------- |
| `SUBMIT_FOR_REVIEW` | CONTENT_AUTHOR, ADMIN | DRAFT → REVIEW       |
| `APPROVE`           | REVIEWER, ADMIN       | REVIEW → APPROVED    |
| `REJECT`            | REVIEWER, ADMIN       | REVIEW → DRAFT       |
| `PUBLISH`           | ADMIN                 | APPROVED → PUBLISHED |
| `ARCHIVE`           | ADMIN                 | any → ARCHIVED       |
| `RESTORE`           | ADMIN                 | ARCHIVED → DRAFT     |

- Any other transition (e.g. `PUBLISH` a DRAFT) → `409 INVALID_STATUS_TRANSITION`.
- Deleting non-DRAFT content → `409 CANNOT_DELETE_NON_DRAFT` (archive instead).
- Deleting a DRAFT parent with non-DRAFT children → `409 HAS_NON_DRAFT_CHILDREN`.
- Duplicate slug/code (program/level/module/lesson/case study/observation) → `409 SLUG_CONFLICT` / `CODE_CONFLICT`.
- A case study/observation referencing a non-existent domain/role/source/objective → `400 REFERENCE_NOT_FOUND`.
- Case studies: `PATCH /admin/case-studies/:id/active` toggles `isActive` independently of the review workflow; `tags` on create/update upserts `Tag` rows and syncs `case_study_tags`.
- Search/filter/pagination: `GET /admin/case-studies?search=consent&riskCategory=HIGH&difficulty=HARD&page=1&pageSize=20`.
- `pnpm --filter @gcp/api test:e2e` — `admin-content.e2e-spec.ts` exercises the full hierarchy, sources, case studies (tags/references/activation/search) and observations against the real database, plus authorization (LEARNER → 403, unauthenticated → 401, CONTENT_AUTHOR blocked from PUBLISH/APPROVE).

---

## Stage roadmap

| Stage        | Deliverable                                                                                                                                                                                                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — done** | Monorepo foundation, DB + initial migration, config validation, health check, CI, quality gates.                                                                                                                                                                                                                                              |
| **2 — done** | Full relational schema: RBAC (roles/permissions), training structure (program→level→module→lesson→objective), sources, case studies/observations, question engine storage, exam blueprints, exam attempts, certificates. 25 tables, 49 FKs, CHECK constraints, partial unique indexes. No services/business logic yet.                        |
| **3 — done** | Auth: register → OTP email verify (hashed, expiring, attempt-limited) → password (argon2id) → login (JWT access + rotating httpOnly refresh) → logout → global auth guard + RBAC foundation → rate limiting on every sensitive route. Learner profile / training-level selection deferred.                                                    |
| **4 — done** | Admin content-management API for all 8 content entities (programs, levels, modules, lessons, learning objectives, sources, case studies, observations): CRUD, DRAFT→REVIEW→APPROVED→PUBLISHED→ARCHIVED workflow, ordering, activation/deactivation, version counter, search/filter/pagination, validation, per-action RBAC. No AI generation. |
| 5            | Learner profile + training-level selection; learner-facing content delivery (published programs/levels/modules/lessons), completion tracking, learner UI.                                                                                                                                                                                     |
| 6            | Question engine: all question types + metadata, case-study linkage, admin authoring + review/approval workflow, no correct-answer exposure pre-submission.                                                                                                                                                                                    |
| 7            | Exam blueprint engine: domain / difficulty / type / level / case-study-proportion rules, weighted random selection within blueprint.                                                                                                                                                                                                          |
| 8            | Exam engine: server-side sessions, randomized question + option order, single active attempt, time limits + expiration, submission locking, server-side scoring, audit events.                                                                                                                                                                |
| 9            | Certificates: unique ID, record, PDF, public verification page + QR, ACTIVE / EXPIRED / REVOKED lifecycle.                                                                                                                                                                                                                                    |
| 10           | Admin console consolidation (users/roles) + audit-log viewer + publishing/versioning UI polish.                                                                                                                                                                                                                                               |
| 11           | AI-assisted content pipeline scaffolding — ingestion → concept mapping → candidate questions → **human review queue** (never auto-publishes).                                                                                                                                                                                                 |
| 12           | Hardening: security review, performance, observability, backup/restore, deployment manifests, accessibility audit.                                                                                                                                                                                                                            |

Each stage ends with: summary, file list, tests, typecheck, lint, build, error
triage, manual-verification commands — then **stop** for review before the next.

---

## Security notes

- Secrets only via environment variables; `.env*` is git-ignored (`.env.example` is not).
  `JWT_ACCESS_SECRET` / `OTP_PEPPER` ship as obviously-fake placeholders in
  `.env.example` — generate real ones (see "Getting started") for any real use.
- Passwords are hashed with **argon2id**. OTP codes are never stored in plain
  form — only an HMAC-SHA256(code, server pepper) — and never appear in any API
  response; the dev mail transport logs them to the server console only.
- Auth: short-lived signed JWT access tokens (15m default) carrying a `purpose`
  claim so an access token can never be replayed as an email-verification
  token or vice versa; opaque, hashed, **rotating** refresh tokens (30d default)
  delivered only via an httpOnly/SameSite=lax cookie, revoked on logout and on
  every use (rotation), never returned in a JSON body.
- `JwtAuthGuard` is global — every route requires authentication by default;
  `@Public()` is the explicit, auditable opt-out (used by `/health` and the
  pre-login auth routes). `RolesGuard` + `@Roles()` enforce RBAC on top of it.
- Rate limiting: register/verify-email/set-password/login/refresh are
  additionally throttled (10 req/60s/IP by default — see `auth.constants.ts`)
  on top of the global limit, specifically to blunt credential/OTP brute-forcing.
- API: `helmet`, strict `ValidationPipe` (whitelist + forbid unknown), CORS allow-list
  from config, global rate limiting (`@nestjs/throttler`).
- Database: parameterised access via Prisma; FK constraints on every relation; CHECK
  constraints on numeric/percentage fields; `audit_log` is append-only (enforced by
  triggers, not just convention); `exam_attempts`/`exam_blueprints` carry partial
  unique indexes enforcing "one active attempt per learner" and "one default
  blueprint per level" at the database level.
- RBAC is fully DB-driven: `roles`/`permissions`/`role_permissions`/
  `user_role_assignments` tables (seeded with a baseline role + permission set),
  not a hard-coded enum — admins can extend it without a migration. `@Roles()`
  is now fully wired end to end: `JwtAuthGuard` populates the request
  principal's roles from the database on every request; `RolesGuard` enforces.
- `apps/api/.env` (git-ignored) holds a dedicated, low-privilege PostgreSQL role
  created for this project — never the database superuser.
