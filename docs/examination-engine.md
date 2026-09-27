# Examination Engine Foundation (Stage 7A + Gate 7B)

## What this is — and what it is not

Stage 7A builds the **configuration and validation foundation** for the future
certification examination engine: exam identity and versioning, blueprint
rules, deterministic blueprint validation, question eligibility, and coverage
diagnostics.

> **Stage 7A does NOT create or run live examination attempts.** There is no
> exam session, no runtime question selection, no randomization, no timer, no
> answer submission, no scoring, no pass/fail result, and no certificate. All
> of that is explicit future-stage scope.

The one thing this stage guarantees end-to-end: **only a `PUBLISHED`,
current, active, quality-clean `QuestionVersion` can ever be counted as
eligible** for an exam. AI-generated candidates (Stage 6B) are never eligible
— they are a separate model entirely and are never queried by anything in
this stage.

## Architecture overview

```
apps/api/src/modules/admin/exams/
├── exams.module.ts
├── exams.service.ts                     Exam + ExamVersion CRUD/versioning/lifecycle
├── exam-blueprint.service.ts            blueprint + rule CRUD
├── exam-blueprint-validation.service.ts deterministic 20-point validation
├── exam-blueprint-coverage.service.ts   diagnostic pool-coverage analysis
├── exam-question-eligibility.service.ts THE authority on question eligibility
├── exam-blueprint-rule.util.ts          shared rule-dimension helpers
├── exam-version-workflow.ts             DRAFT/ACTIVE/INACTIVE/ARCHIVED transitions
├── exam-common.ts                       "always operate on the latest version" helper
├── exams.controller.ts                  /api/admin/exams/**
└── dto/
```

### Schema: Exam → ExamVersion → ExamBlueprint → ExamBlueprintRule

This mirrors the existing Stage 6 `Question` / `QuestionVersion` split
exactly, for the same reason: **`Exam` is the stable identity** (a business
`code`, a `TrainingProgram`, and a pointer to whichever version is currently
`activeVersionId` — mirroring `Question.currentPublishedVersionId`); **all
substantive configuration and its lifecycle live on `ExamVersion`**, which is
never overwritten in place once it leaves `DRAFT`.

```
Exam
  ├─ code (stable, unique, never reused)
  ├─ trainingProgramId
  └─ activeVersionId ──┐
                        ▼
                  ExamVersion (versionNumber, status)
                  ├─ levelId, questionCount, marksPerQuestion,
                  │  totalMarks, passPercentage, durationMinutes,
                  │  maxAttempts
                  └─ blueprint (1:1)
                        └─ rules (many)
```

### Documented schema correction

Stage 2 had already seeded placeholder `ExamBlueprint` / `ExamBlueprintRule` /
`ExamAttempt` tables directly scoped to a `TrainingLevel`, with an explicit
note that business logic was out of scope for that stage. Those tables had
**zero rows and zero consuming code anywhere** (verified before this change).
Stage 7A replaces that placeholder shape with the `Exam → ExamVersion →
ExamBlueprint → ExamBlueprintRule` hierarchy described above, and updates
`ExamAttempt` to reference `ExamVersion` instead of the old flat
`ExamBlueprint`. Because nothing had ever written to the old tables, this is a
safe redesign, not a destructive change to real data. The unused
`BlueprintRuleType` enum (single-dimension rule discriminator) was removed in
favor of letting a rule constrain several dimensions at once, per the Stage 7A
spec's explicit examples.

### Exam versioning and "never silently mutate"

- A new `Exam` is created with its first `ExamVersion` (`versionNumber: 1`,
  `status: DRAFT`) in the same request.
- Every admin endpoint addressed by exam id (`GET/PATCH .../:id`, blueprint
  endpoints, validate, coverage) always operates on the exam's **latest**
  version — mirroring how the Stage 6 question endpoints always operate on
  `question.versions[0]`.
- Editing a `DRAFT` version's configuration (`questionCount`,
  `marksPerQuestion`, `totalMarks`, `passPercentage`, `durationMinutes`,
  `maxAttempts`, `levelId`) updates it in place.
- Editing those same fields on a non-`DRAFT` version instead **creates a new
  version** (`versionNumber + 1`, cloned from the current one, `status:
DRAFT`) — the old version is never mutated. `name`/`description` live on
  `Exam` itself and can always be edited directly, since they don't change
  what the exam certifies.
- Blueprint create/replace is only allowed while the target version is
  `DRAFT`; attempting it on any other status returns a 409
  (`EXAM_VERSION_NOT_EDITABLE`) telling the admin to create a new version
  first.

### Lifecycle

```
DRAFT ──ACTIVATE──► ACTIVE ──DEACTIVATE──► INACTIVE ──ACTIVATE──► ACTIVE
  │                                            │
  └──────────────────ARCHIVE──────────────────┘
                       │
                    ARCHIVED ──RESTORE──► DRAFT
```

`ACTIVATE` is only reachable from `DRAFT` or `INACTIVE`, and always re-runs
deterministic blueprint validation first — an invalid blueprint blocks
activation with a structured error (`BLUEPRINT_VALIDATION_FAILED`) and no
state changes. Activating sets `Exam.activeVersionId` to the newly-active
version and demotes any previously-active version of the same exam to
`INACTIVE`. `ARCHIVE` is intentionally **not** reachable directly from
`ACTIVE` — an admin must `DEACTIVATE` first, which is the "active exam
protection" the spec asks for made explicit in the state machine itself
rather than left as an application-level special case.

## Blueprint architecture

A blueprint belongs to exactly one `ExamVersion` (1:1) and holds an ordered
list of `ExamBlueprintRule` rows. A rule may constrain **any combination** of:
`questionType`, `difficulty`, `domainId`, `professionalRoleId`, `levelId`
(overriding the exam version's own level for that rule only),
`learningObjectiveId`, `caseStudyRequired`, `sourceRequired` — plus
`minimumCount` / `maximumCount` / `exactCount`, a diagnostic `priority`, and
`isActive`. The blueprint itself never selects a question; it only describes
the target distribution for a future selection engine to consume.

POST creates a blueprint only if one doesn't already exist (409
`BLUEPRINT_ALREADY_EXISTS` otherwise); PATCH replaces the entire rule set
transactionally (delete-then-recreate) rather than diffing a partial update —
kept deterministic and simple rather than inventing partial-patch semantics
for a data shape this small.

## Question eligibility — the single deterministic authority

`ExamQuestionEligibilityService` is the **only** place that decides whether a
`QuestionVersion` may ever enter an exam pool. A version is eligible only if
**all** of the following hold:

1. `reviewStatus === 'PUBLISHED'`
2. It **is** the question's current published version — checked via the
   inverse one-to-one relation `currentForQuestion: { isNot: null }`, not by
   comparing `reviewStatus` alone. This matters: publishing a new version
   never resets an old version's `reviewStatus` back off `PUBLISHED`, so
   `reviewStatus` alone would wrongly admit stale historical versions.
3. `isActive === true`
4. At least two active options, exactly one of them correct
5. Passes the same deterministic quality check Stage 6 already uses
   (`assessQuestionQuality` — non-empty stem, no duplicate/empty options,
   etc.) — reused, not duplicated

`checkEligibility(questionVersionId)` returns a structured result:

```json
{ "eligible": false, "reasons": ["QUESTION_NOT_PUBLISHED", "MISSING_CORRECT_OPTION"] }
```

This is admin-only diagnostic information. There is no learner-facing
endpoint anywhere in Stage 7A that could leak it, and it never will be —
learners have zero access to any `/admin/exams/**` route.

`countEligible(filter)` / `listEligibleIds(filter)` apply the same dimension
filters a blueprint rule can express (level, domain, role, type, difficulty,
objective, case-study/source requirement) as a Prisma `where` clause, then
apply the option/quality checks in application code before counting — quality
integrity isn't expressible as a single SQL filter, so the coarse candidate
set is fetched and filtered in memory. This is the shared building block both
blueprint validation and coverage analysis call into, so they always count
the same pool the same way.

## Deterministic blueprint validation

`ExamBlueprintValidationService.validate()` — **no AI, ever** — runs the full
20-point checklist from the spec before an `ExamVersion` may become `ACTIVE`:
questionCount/passPercentage/totalMarks/durationMinutes/maxAttempts sanity,
rule-level exactCount/min/max contradictions, sum-of-exactCounts against
questionCount, referenced level/domain/role/type/difficulty/objective
existence, duplicate-rule detection, overall pool sufficiency, and per-rule
pool sufficiency for every mandatory rule. It returns
`{ valid, errors, warnings, checks }` — the same shape Stage 6B's AI-output
validator already established, for consistency across the codebase. Errors
block activation; warnings (e.g. "no active rules configured") never do.

**Documented simplification** — validation item 10 ("sum of minimum counts
does not exceed questionCount where rules are mutually exclusive") is not a
full constraint-satisfaction solver. A rule is only grouped with others for
this specific cross-rule sum when `questionType` is its _sole_ constraining
dimension, since question type is the one dimension a single question can
never simultaneously satisfy two values of. Rules that combine multiple
dimensions are excluded from this particular sum (they are still individually
checked against their own eligible pool via item 19). This is intentionally
conservative rather than a claim of full feasibility proof — see
`exam-blueprint-rule.util.ts#exclusiveGroupKey` for the exact algorithm.

## Coverage analysis (diagnostic only)

`ExamBlueprintCoverageService.analyze()` reports, per active rule, the
eligible pool size and whether it meets that rule's requirement, plus the
overall eligible pool size and a `feasible` boolean:

```json
{
  "questionCountRequired": 20,
  "eligiblePoolSize": 147,
  "rules": [{ "ruleId": "...", "eligiblePool": 31, "sufficient": true }],
  "feasible": true
}
```

This **never selects actual exam questions** — it exists purely so an admin
can see why a blueprint would or wouldn't work before activating it.

## Insufficient pools fail safely

If a blueprint requires more questions of a given kind than currently exist,
validation reports `valid: false` with a specific error
(`"Rule <id> requires 4 eligible question(s) but only 2 exist."`) and
activation is refused with a 409. Nothing silently relaxes the blueprint,
fills gaps with unrelated questions, or asks AI to generate replacements.

## Initial certification configuration

Stored as `ExamVersion` fields, never hard-coded into any controller or
service:

| Field              | Initial value                                       |
| ------------------ | --------------------------------------------------- |
| `questionCount`    | 20                                                  |
| `marksPerQuestion` | 5                                                   |
| `totalMarks`       | 100                                                 |
| `passPercentage`   | 80                                                  |
| `maxAttempts`      | 1                                                   |
| `durationMinutes`  | supported, unset by default (future timer use only) |

A future scoring engine reads `totalMarks` and `passPercentage` to compute the
pass threshold (16/20 in this example) — that arithmetic does not exist
anywhere in Stage 7A.

## Authorization

Stage 7A grants examination configuration **exclusively to `ADMIN`** —
`CONTENT_AUTHOR` and `REVIEWER` have zero access to any `/admin/exams/**`
route, and `LEARNER` is denied everywhere. This is a deliberate, narrower
scoping than the Stage 6 question bank (which splits author/reviewer/admin
capabilities): the spec explicitly withholds activation authority from
`CONTENT_AUTHOR`/`REVIEWER` and grants no other exam capability to either
role, so the whole controller is gated `@Roles([UserRole.ADMIN])` rather than
inventing an unstated author/reviewer split for exam configuration.

## Audit logging

Nine new append-only `AuditAction` values, all via the existing
`AuditService`: `EXAM_CREATED`, `EXAM_UPDATED`, `EXAM_VERSION_CREATED`,
`EXAM_BLUEPRINT_CREATED`, `EXAM_BLUEPRINT_UPDATED`,
`EXAM_BLUEPRINT_VALIDATED`, `EXAM_ACTIVATED`, `EXAM_DEACTIVATED`,
`EXAM_ARCHIVED`. No second audit system was created.

## Admin UI

- **`/admin/exams`** — list with status filter, disclaiming up front that
  Stage 7A has no live exam session yet.
- **`/admin/exams/new`** — create an exam + its initial DRAFT version.
- **`/admin/exams/:id`** — configuration, lifecycle transition buttons
  (only the actions valid for the current status are shown), version
  history. Editing a non-DRAFT version's settings is clearly labeled as
  creating a new version rather than mutating the current one.
- **`/admin/exams/:id/blueprint`** — rule editor (add/remove/edit rules),
  "Validate & check coverage" running both the deterministic validator and
  the coverage analysis and rendering the full checklist, errors, warnings,
  and per-rule pool sizes. The backend remains authoritative: the UI cannot
  force an invalid blueprint to ACTIVE regardless of what it renders.

## Security boundaries

- No learner-facing endpoint exists anywhere in this stage.
- `QuestionOption.isCorrect`, answer keys, and internal eligibility reason
  codes are only ever returned to authenticated ADMIN requests on
  `/admin/exams/**` — the same boundary Stage 6 already enforces for the
  question bank itself.
- AI cannot enter this path at all: the eligibility service, validator, and
  coverage service query only `Question` / `QuestionVersion` — never
  `AiQuestionCandidate`.

## Future runtime architecture (not implemented here)

```
EXAM VERSION → BLUEPRINT → ELIGIBILITY SERVICE → PUBLISHED QUESTION POOL
   → CONSTRAINT SATISFACTION → SELECT QuestionVersion IDs → EXAM ATTEMPT
   → SNAPSHOT QuestionVersion → RANDOMIZED PRESENTATION → LEARNER ANSWERS
   → SERVER-SIDE SCORING → RESULT → FUTURE CERTIFICATE ENGINE
```

At exam-start time, a future stage will: load the blueprint, compute the
eligible pool via this same `ExamQuestionEligibilityService`, run actual
constraint satisfaction to pick specific `QuestionVersion` IDs, persist them
onto `ExamAttemptQuestion` (already shaped correctly — see below),
randomize presentation order and (where safe) option order, and never
re-select questions on a subsequent request for the same attempt.

### `ExamAttemptQuestion` already points at `QuestionVersion`, not `Question`

This was already correct in the Stage 2 placeholder and required no change:
`ExamAttemptQuestion.questionVersionId` references the exact
`QuestionVersion` served, so if `Question` is later republished as a new
version, an existing historical attempt keeps pointing at the exact version
the learner actually saw.

## Known limitations of Stage 7A

- No exam session, no question selection at runtime, no randomization, no
  timer enforcement, no answer submission, no scoring, no pass/fail result,
  no certificate — all explicit future-stage scope.
- Blueprint validation's "mutually exclusive" sum check is a documented,
  conservative simplification (see above), not a full CSP solver.
- `durationMinutes` is stored but never enforced — no live timer exists.
- Coverage/validation pool counts are computed on demand; there is no cached
  or pre-aggregated pool size, which is fine at the current expected data
  volume but would need revisiting at much larger question-bank scale.

---

# Gate 7B — Secure Exam Session, Blueprint-Constrained Selection & Snapshot

## What this is — and what it is not

Gate 7B takes an eligible learner and an ACTIVE `ExamVersion` and
instantiates a **deterministic, immutable exam attempt**: a fixed set of
eligible `QuestionVersion`s, selected once according to the active blueprint,
with their presentation order and each question's option order persisted
permanently.

> **Gate 7B does NOT implement scoring, pass/fail determination, a timer,
> answer submission, answer storage, a results page, or certificates.** Those
> are explicit later-gate scope. This gate ends the moment a learner can
> safely retrieve their instantiated question set.

## Sequence

```
Learner
  |
  v
POST /api/learner/exams/:examId/start
  |
  v
LearnerExamAttemptService
  |
  |-- resolve Exam.activeVersionId -> ACTIVE ExamVersion (server-only; the
  |     learner never supplies a version, question, or count)
  |-- idempotent reopen check: existing IN_PROGRESS attempt for
  |     (learner, this ExamVersion)? -> return it, no new selection
  |-- platform-wide check: a DIFFERENT exam already IN_PROGRESS for this
  |     learner? -> 409 ACTIVE_ATTEMPT_EXISTS
  |-- learner eligibility (profile, enrollment, EXAM_ELIGIBLE, max attempts)
  |-- ExamBlueprintValidationService.validate() - REVALIDATED NOW, never
  |     assumed still true from activation time
  v
ExamQuestionSelectionService
  |
  |-- ExamQuestionEligibilityService.listEligible() - the ONE authoritative
  |     eligible-pool query (PUBLISHED + current + active + quality-clean)
  |-- blueprint-constrained selection (bounded retries, never
  |     ORDER BY RANDOM() LIMIT n)
  |-- final deterministic validation of the chosen set
  v
QuestionVersion IDs (content decided) -> secure shuffle (presentation order)
  |                                    -> secure shuffle per question (option order)
  v
Prisma transaction
  |-- create ExamAttempt (attemptNumber, totalQuestions, startedAt, expiresAt?)
  |-- createMany ExamAttemptQuestion (questionVersionId, sortOrder)
  |-- createMany ExamAttemptQuestionOption (questionOptionId, presentationOrder)
  |-- (all-or-nothing: any failure rolls back the whole attempt)
  v
audit: EXAM_STARTED (or EXAM_ATTEMPT_REOPENED)
  v
Safe learner payload (no answer keys, no blueprint internals)
```

## Learner eligibility

Reuses Stage 5 exactly - no eligibility rule is re-derived:

- `isProfileComplete()` (`learner/common/profile-completion.ts`)
- an `ACTIVE` `Enrollment` matching the exam's `trainingProgramId` and the
  resolved `ExamVersion.levelId`
- `TrainingStateComputer.summarize(enrollment).examEligible` (module
  completion against currently-published modules)

Only after all three pass does the service even look at the blueprint or the
question pool.

## ExamVersion resolution - the learner cannot choose

The request carries only `:examId` in the URL - no body, no version, no
question count, no blueprint parameters. The server resolves
`Exam.activeVersionId` itself and rejects (`EXAM_NOT_ACTIVE`) if it is null,
or (`EXAM_VERSION_NOT_ACTIVE`) if the resolved version somehow is not
`ACTIVE` (defensive - this should never happen given the Stage 7A invariants,
but Gate 7B never assumes it). Any JSON body the client sends is parsed and
silently ignored by the route (there is no DTO for it at all) - verified by
an e2e test that POSTs a body attempting to set `examVersionId`,
`questionCount`, and `questionIds` and asserts none of it took effect.

## Blueprint revalidation

A blueprint that was valid when the `ExamVersion` was activated is **not**
assumed valid at attempt-creation time. `startExam` always calls
`ExamBlueprintValidationService.validate()` again, right before selection.
If the pool has shrunk since activation (e.g. a question was later
archived), this now correctly fails with `BLUEPRINT_INVALID` - verified by an
e2e test that activates a blueprint requiring 2 matching questions (exactly 2
exist), then archives one of them, then confirms `start` is rejected even
though `ACTIVATE` originally succeeded.

## Question selection - reusing, not duplicating, eligibility

`ExamQuestionSelectionService` never re-implements PUBLISHED/current/quality
checks. It calls `ExamQuestionEligibilityService.listEligible()` (a Gate 7B
addition returning full candidate dimensions, not just IDs, exposed through
the exact same eligibility engine Stage 7A's admin coverage/validation
already use) to obtain the whole eligible pool for the version's level, then
runs a pure, independently-testable algorithm
(`apps/api/src/modules/learner/exams/exam-selection.util.ts`):

1. Shuffle the eligible pool with Node's `crypto.randomInt` (never
   `Math.random()`).
2. Process rules most-constrained-first (largest `exactCount`/`minimumCount`
   first), greedily assigning shuffled candidates that match each rule until
   its requirement is met. A candidate already assigned for one rule counts
   toward every OTHER rule it also matches - a single question can satisfy
   several rules at once, exactly as two learners' independently-selected
   sets both must.
3. Fill remaining slots from the rest of the pool, skipping any candidate
   that would push an `exactCount`/`maximumCount`-capped rule over its cap.
4. Independently re-validate the complete candidate set (exact question
   count, uniqueness, every rule's min/max/exact) before ever accepting it.
5. If invalid, retry with a fresh shuffle, bounded by `MAX_SELECTION_ATTEMPTS
= 100`. If no attempt succeeds, fail deterministically - never relax a
   rule, never substitute an unrelated question, never call AI.

Failure carries structured diagnostics
(`{ reason: 'INSUFFICIENT_ELIGIBLE_POOL' | 'CONSTRAINTS_NOT_SATISFIABLE',
requiredQuestionCount, eligibleQuestionCount, unmetRules }`) that are logged
server-side (`Logger.warn`) but **never returned to the learner** - the
learner only ever sees a generic `INSUFFICIENT_ELIGIBLE_QUESTIONS` or
`BLUEPRINT_SELECTION_FAILED` with no rule-level detail, per the "do not leak
internal blueprint diagnostics" requirement.

**Documented limitation**: this is a bounded-retry randomized search, not a
proof-producing constraint solver. It always succeeds when a solution is
easy to find (the common case) and always terminates within 100 attempts,
but a pathologically narrow blueprint that is _technically_ satisfiable only
via one exact arrangement out of a huge pool could exhaust its retries and
report failure even though a solution exists in principle. This tradeoff is
deliberate and disclosed, not silently accepted.

## QuestionVersion snapshotting - the immutability guarantee

`ExamAttemptQuestion.questionVersionId` is set once, at creation, from the
selection result. Nothing in Gate 7B ever re-reads
`Question.currentPublishedVersionId` for an existing attempt. This was
verified live: an e2e test starts an attempt, edits and republishes one of
its selected questions (Stage 6 forks a new `QuestionVersion` rather than
mutating the published one), and confirms `GET .../questions` still returns
the _original_ stem - the question's `currentPublishedVersionId` has moved on,
but the attempt has not.

## Randomization - question order and option order

Two independent secure shuffles happen once, at creation:

- **Question presentation order** -> `ExamAttemptQuestion.sortOrder`
  (`@@unique([attemptId, sortOrder])`).
- **Option presentation order**, per question -> the new
  `ExamAttemptQuestionOption` table (`questionOptionId`,
  `presentationOrder`, `@@unique([examAttemptQuestionId, questionOptionId])`
  and `@@unique([examAttemptQuestionId, presentationOrder])`). This is a pure
  ordering record - the option's actual text always comes from the
  historical `QuestionOption` row via a join at read time, never copied, so a
  later (impossible, since PUBLISHED options are never mutated in place) edit
  could never desync it.

`GET .../questions` always reads the persisted order (`ORDER BY sort_order` /
`ORDER BY presentation_order`) - **never** `ORDER BY RANDOM()`. Verified by an
e2e test calling the same GET three times and asserting identical question
and option order every time.

## Persistence / idempotency

`POST start` is idempotent by design, tested explicitly:

- If an `IN_PROGRESS` attempt already exists for (learner, this
  `ExamVersion`), it is returned as-is - no new selection, no new rows. This
  is audited as `EXAM_ATTEMPT_REOPENED`, not `EXAM_STARTED`.
- Calling `start` three times in a row returns the same `attemptId` every
  time, and exactly one `ExamAttempt` row exists afterward (asserted via a
  direct DB count in the e2e suite).

## Concurrency protection - and a discovered pre-existing constraint

While implementing this, a **pre-existing Stage 2 constraint** was found that
the initial design had missed: `exam_attempts_one_active_per_user` (added in
`20260905044505_stage2_partial_indexes`) is a partial unique index on
`exam_attempts(user_id)` where `status = 'IN_PROGRESS'` - it already enforces
a **platform-wide** policy of at most one in-progress exam attempt per
learner, across _every_ exam, not merely one per exam version. Gate 7B's
service logic now explicitly honors this:

1. Same-`ExamVersion` in-progress attempt -> reopen (see above).
2. A **different** exam already in progress for this learner -> 409
   `ACTIVE_ATTEMPT_EXISTS` ("finish or abandon it before starting another").
3. Only then does the transactional create happen.

A narrower per-`(user, examVersion)` partial index was added earlier in this
same gate before this was discovered; it was redundant given the
pre-existing broader index and was removed in a follow-up migration
(`20261015000030_gate7b_remove_redundant_index`) - a documented schema
correction, not a destructive change (dropping an index never touches data).

The database constraint remains the actual source of truth, not
application-level check-then-insert: the transactional insert can still lose
a race to a concurrent request, in which case the resulting `P2002` is caught
and mapped to the correct outcome (reopen the same-version winner, or
`ACTIVE_ATTEMPT_EXISTS` if the winner was a different exam) - never a raw 500. Verified by an e2e test firing three concurrent `start` requests at the
same exam and asserting exactly one `ExamAttempt` row survives.

## Attempt ownership

`getAttempt` / `getAttemptQuestions` scope every query with
`WHERE id = :attemptId AND user_id = :callerId` (mirroring
`EnrollmentsService`'s existing "never distinguish not-yours from
doesn't-exist" pattern exactly). A request for another learner's attempt and
a request for a genuinely nonexistent attempt id return the **identical**
404 `ATTEMPT_NOT_FOUND` response - verified by an e2e test comparing both
response bodies byte-for-byte on `code` and `title`. `ATTEMPT_ACCESS_DENIED`
exists in the error-code vocabulary for completeness but is deliberately
never thrown by the learner API, since using it would itself leak that a
requested attempt exists.

## Safe learner payload / answer-key protection

The learner-facing question payload is built with an explicit, hand-written
DTO (`ExamAttemptQuestionsView`) - never a raw Prisma passthrough. The Prisma
`select` for `QuestionOption` only ever requests `{ id, content }`;
`isCorrect` and `explanation` are never fetched from the database for this
code path, so there is no field to accidentally forget to strip. Verified by
an e2e test that stringifies the raw HTTP response body and asserts the
absence of `isCorrect`, `correctOptionId`, `answerKey`, and `explanation`
anywhere in it.

## AI exclusion

`ExamQuestionSelectionService` and `ExamQuestionEligibilityService` query
only `Question` / `QuestionVersion` - neither queries, imports, nor depends
on `AiQuestionCandidate`, `AiGenerationRun`, or any AI provider in any way.
An AI-generated question can only ever enter the exam pool via the existing
Stage 6B conversion path (creating an ordinary DRAFT `QuestionVersion` that
then must go through the full human review -> publish workflow like any
other question) - there is no shortcut. Verified by an e2e test confirming
none of a started attempt's selected `QuestionVersion` IDs match any
`AiQuestionCandidate.convertedQuestionVersionId`.

## Transaction behaviour

Attempt creation (`ExamAttempt` + all `ExamAttemptQuestion` rows + all
`ExamAttemptQuestionOption` rows) happens inside one `prisma.$transaction`.
Any failure - a constraint violation, an unexpected error - rolls back the
entire transaction; Gate 7B never persists a partial attempt (e.g. 18 of 20
questions). A transaction failure unrelated to the concurrency race maps to a
generic `ATTEMPT_CREATION_FAILED` 500 with no internal detail leaked to the
learner.

## Audit logging

Reuses the existing `AuditService` - no second audit system. `EXAM_STARTED`
(a pre-existing, previously-unused Stage 2 audit action - reused rather than
inventing a duplicate `EXAM_ATTEMPT_CREATED`) records genuine creation;
`EXAM_ATTEMPT_REOPENED` (new) records every idempotent re-hit of `start` for
an already-in-progress attempt. A normal `GET` is never audited, matching the
existing audit policy of not logging routine reads.

## APIs

All under `/api/learner/exams/**`, following the existing learner-module
convention of **no `@Roles()` decorator** - every learner/\* controller in
this codebase is authenticated-only and scoped to `@CurrentUser()`, never
role-restricted, since every route only ever touches the caller's own data
(mirrors `EnrollmentsController` exactly). Route parameters are validated
with `ParseUUIDPipe`.

- `POST /api/learner/exams/:examId/start` - create or reopen the caller's
  attempt at this exam. Returns 200 either way (idempotent), not 201-only.
- `GET /api/learner/exams/attempts/:attemptId` - attempt metadata (status,
  question count, timestamps) - no question content.
- `GET /api/learner/exams/attempts/:attemptId/questions` - the safe question
  payload (stem, instructions, options in persisted order) - no answers.

## Error codes

New `ExamAttemptErrorCode` (parallel to Stage 7A's `ExamErrorCode`, not a
second framework): `EXAM_NOT_ACTIVE`, `EXAM_VERSION_NOT_ACTIVE`,
`LEARNER_NOT_ELIGIBLE`, `TRAINING_NOT_COMPLETE`, `MAX_ATTEMPTS_EXCEEDED`,
`ACTIVE_ATTEMPT_EXISTS`, `BLUEPRINT_INVALID`,
`INSUFFICIENT_ELIGIBLE_QUESTIONS`, `BLUEPRINT_SELECTION_FAILED`,
`QUESTION_POOL_INVALID`, `ATTEMPT_NOT_FOUND`, `ATTEMPT_ACCESS_DENIED`
(defined, never thrown - see Ownership above), `ATTEMPT_CREATION_FAILED`.

## Database changes

- `ExamAttempt`: added `attemptNumber` (`@@unique([userId, examVersionId,
attemptNumber])`); `expiresAt` (pre-existing field) is now populated from
  `ExamVersion.durationMinutes` at creation, for future use only.
- `ExamAttemptQuestion`: added `@@unique([attemptId, sortOrder])`.
- New `ExamAttemptQuestionOption` table (see above).
- `ExamAttemptStatus` enum: added `PASSED`, `FAILED` as future-scoring
  foundation values - never set by any Gate 7B code path.
- New `AuditAction`: `EXAM_ATTEMPT_REOPENED`.
- Migrations: `20261015000000_gate7b_exam_session_foundation`,
  `20261015000030_gate7b_remove_redundant_index` (the documented schema
  correction above).

## Future scope (explicitly NOT Gate 7B)

- **Timer**: `ExamVersion.durationMinutes` and `ExamAttempt.expiresAt` are
  populated but never enforced, checked, or used to auto-expire an attempt.
  No countdown, no automatic submission.
- **Submission/scoring**: no answer is ever accepted, stored, or graded.
  `ExamAttemptQuestion.selectedOptionId`/`isCorrect`/`answeredAt` remain
  untouched, always null.
- **Results/certificates**: entirely out of scope; `PASSED`/`FAILED` exist
  in the enum only as forward-compatible placeholders.

## Known limitations of Gate 7B

- The selection algorithm is a bounded randomized search, not a
  proof-producing solver (see above) - disclosed, not hidden.
- `MAX_ATTEMPTS_EXCEEDED` counts terminal (non-`IN_PROGRESS`) attempts
  against `ExamVersion.maxAttempts`; since no submission flow exists yet, the
  e2e/unit tests exercise this by inserting a terminal row directly via
  Prisma rather than through a real submission endpoint (which does not
  exist).
- No timer enforcement, no submission, no scoring, no certificate - all
  explicit future scope, not gaps in this gate's own scope.

# Gate 7C - Learner examination interface, navigation & exam state

Gate 7C builds the learner-facing UI on top of Gate 7B's read-only session
APIs. It adds no new backend endpoints, no new database tables, and no
scoring logic - it is a display, navigation, and local-UI-state layer only.

## Route

`GET /exams/attempts/[attemptId]` (`apps/web/src/app/exams/attempts/[attemptId]/page.tsx`),
a client component. The route represents an **existing** attempt only: it
calls `GET .../attempts/:attemptId` and `GET .../attempts/:attemptId/questions`
and never calls the Gate 7B `POST .../start` endpoint. There is no
"start exam" action anywhere in this gate's code - `learnerExamApi`
(`apps/web/src/lib/learner-exam-api.ts`) exposes only `getAttempt` and
`getAttemptQuestions`, so a new attempt cannot be created by navigating to,
refreshing, or reloading this route, nor by any browser back/forward
transition (all of which simply re-run the same two `GET`s against the same
`attemptId` path segment).

## UI architecture

`ExamShell` (`components/learner/exam/exam-shell.tsx`) is a minimal,
purpose-built chrome for the exam route - it deliberately does not reuse the
site-wide `AppShell` navigation, since a certification exam should not
present the learner with links away from the exam. It renders only a title,
an attempt-status badge, and an "Exit exam" link back to `/dashboard`.

Presentational components, each single-purpose:

- `ExamProgress` - "Question X of Y" (presentation order, never a DB ID) plus
  "Answered: N / Total", using the existing `ProgressBar`.
- `QuestionPalette` - direct-jump navigation grid with UNANSWERED / ANSWERED
  / CURRENT state.
- `QuestionCard` - stem, instructions, and a native `<fieldset>/<legend>`
  radio group of options.
- `ExamNavigation` - Previous / Next footer.
- `ExamErrorState` / `ExamLoadingState` - the non-happy-path renders.

## Server state vs. local UI state

The `useExamAttempt` hook (`components/learner/exam/use-exam-attempt.ts`) is
the single boundary between the two, and is documented as such in its source
comments:

- **Server state** (owned by Gate 7B, read-only here): the attempt summary,
  its status, and the fixed question/option set, fetched once per mount via
  `Promise.all`. The frontend never reorders, adds, removes, or otherwise
  mutates this data after loading it.
- **Local UI state** (owned entirely by this gate, never sent to the
  backend): which question index is currently displayed, and the learner's
  in-progress option selections.

## Local answer state

Selections are held as `{ [attemptQuestionId]: selectedOptionId }` and
persisted to `sessionStorage` (`apps/web/src/lib/exam-answer-storage.ts`),
keyed per `attemptId` (`gcp-exam-answers:<attemptId>`) - **not**
`localStorage`. This was a deliberate choice: Gate 7D's real, authoritative,
server-side answer persistence does not exist yet, so these values are not
"saved" in any durable sense - they are a same-tab, same-session convenience
that survives an in-tab refresh but is not claimed to survive closing the
browser, switching devices, or any other durability guarantee a learner
might reasonably infer from "saved." `localStorage` was rejected specifically
because its cross-session durability would misrepresent that guarantee.
Storage is read defensively (malformed JSON, non-object values, and
non-string map values are all discarded rather than thrown) and never stores
anything beyond the selected option ID - no correctness, explanation, or
scoring data ever passes through it.

## Navigation

Previous is disabled on the first question; Next is disabled on the last,
where it is replaced by review-hint text. There is **no submit action
anywhere** in this gate - not on the last question, not in the palette, not
in the header. The learner can move to any question, answered or not,
without being forced to answer first. The palette allows direct jumps and
never triggers a network request - it operates purely on the already-loaded
question array and local answer state.

## Persisted question/option order

The frontend renders `questions` and each question's `options` in exactly
the array order Gate 7B returned (`presentationOrder` is displayed, e.g. via
numbering, but never used to re-sort - the array order and the
`presentationOrder` field already agree, by Gate 7B's own contract).
Nothing in this gate shuffles, sorts, or caches-then-reorders either array.

## Refresh, back/forward, and remount behaviour

Because the route is keyed entirely off the `attemptId` path segment and
`useExamAttempt` always re-fetches both `GET`s on mount, a full page refresh,
a browser back/forward navigation, or an unrelated remount all reconstruct
the same UI against the same attempt and the same question set - none of
them create a new attempt or request a new selection. Local answers
reconstruct from `sessionStorage` if present in the same tab; the current
question index resets to the first question, since no index is persisted
server-side.

## Accessibility

- Options are grouped with native `<fieldset>/<legend>` and `<input
type="radio">` sharing one `name` per question, giving correct radio-group
  semantics for free.
- The question stem is an `<h2>`, focused programmatically on question
  change so screen readers announce the new question.
- The palette uses `aria-current="true"` on the current question and an
  `aria-label` that composes every applicable state (e.g. "Question 3,
  current question, answered"), fixed during testing after a bug where a
  question that was simultaneously current and answered silently lost its
  "answered" label - now both facts are always included together.
- State is never color-only: the palette pairs color with a checkmark glyph,
  border-weight changes, and a text legend (Current / Answered /
  Unanswered).
- Progress text lives in an `aria-live="polite"` region so question changes
  are announced; the loading skeleton uses `role="status" aria-live="polite"
aria-busy="true"`.

## Responsive design

The palette grid reflows by breakpoint (`grid-cols-6` down to `grid-cols-4`)
rather than scrolling horizontally; the header, progress bar, and navigation
footer stack in a single readable column at narrow widths. No layout relies
on horizontal scrolling as primary navigation.

## Network failure handling

`ExamErrorKind` classifies every failure into `not-found` (404),
`forbidden` (403), `invalid` (409 or a schema-validation failure - i.e. a
malformed or contract-violating payload), `network` (fetch/connection
failure), or `server` (500 and other unclassified failures), each rendered
through `ExamErrorState` with a plain, non-technical message - no stack
trace, no raw error body, ever reaches the DOM. `network` and `server`
states offer a "Try again" retry; `not-found`/`forbidden`/`invalid` do not,
since retrying an unauthorized or nonexistent attempt cannot succeed.
`UnauthenticatedError` (expired/invalid auth) is handled as a side effect -
an immediate redirect to `/login` - rather than a rendered error state, so
no exam content or metadata is ever left on screen after an auth failure.
An empty `questions` array is treated as an `invalid` state, not an empty
exam - the learner can never enter a partially-loaded or fabricated exam.

## Loading state

`ExamLoadingState` renders a skeleton (not "Question 1 of Y") until both
`GET`s resolve, avoiding both a false-content flash and a layout jump once
real content arrives.

## Timer

Deferred entirely, matching Gate 7B's own "populated but never enforced"
`expiresAt`/`durationMinutes` fields. Gate 7C does not render any
countdown or elapsed-time display: `expiresAt` is precise enough to compute
a display-only remaining-time value, but a display-only client countdown
this early risks being mistaken by users or future maintainers for real
enforcement (there is no server-side expiry check yet for it to reflect),
so it is left for a gate that pairs it with actual enforcement rather than
shipping a number that means nothing operationally.

## Security boundary

- Every field the shared zod schemas accept mirrors Gate 7B's actual
  Prisma `select` - there is no `isCorrect`, `correctOptionId`, `answerKey`,
  `explanation`, or `rationale` field anywhere in the contract for the UI to
  accidentally render, not merely a component that has been told not to
  render it. Component tests additionally inject these fields into mock
  response data and assert they never appear in the rendered DOM, covering
  the case where a future backend regression leaks them anyway.
- All client-held state (current question, selections) is untrusted and
  never used for authorization; the backend remains the sole source of
  truth for attempt ownership and status.
- The frontend cannot create, submit, or transition an attempt - no such
  calls exist in `learnerExamApi`.
- No AI provider, generation service, or candidate data is referenced from
  any exam-route component.
- No certificate, QR, or verification code is created or displayed.
- This gate makes no anti-cheating claims: no dev-tools blocking, no
  navigation lockdown, no screenshot prevention, no device/webcam/screen
  monitoring. Assessment integrity is, and remains, a server-side concern
  (expanded in a future gate).

## No scoring, no submission, no AI

Explicitly out of scope and not implemented: authoritative answer
submission, scoring, pass/fail determination, a results page, certificate
generation, timer enforcement, auto-submission, adaptive testing,
proctoring, and any AI-assisted content on the exam route.

## Testing

`exam-answer-storage.test.ts` (7), `question-palette.test.tsx` (5), and
`page.test.tsx` (21) - 33 new frontend tests, all passing, covering loading,
rendering in persisted order, answer selection/change, progress
calculation, previous/next disabled states, no-submit-anywhere, direct
palette navigation without extra requests, combined current+answered
palette labeling, 404/403/network/malformed-payload/empty-question-set/auth-redirect
handling, remount idempotency (exactly one `getAttempt`/`getAttemptQuestions`
call pair per mount - never an extra call that would suggest a second
attempt), a security-focused block asserting no answer-key/scoring field or
text ever renders even when injected into mock data, an accessibility block
asserting native fieldset/legend grouping and heading semantics, and a
contract smoke test that runs a raw fixture through the **real**
`examAttemptSummarySchema`/`examAttemptQuestionsResponseSchema` `.parse()`
calls from `@gcp/shared` (not just the test's own mocks), so that any future
drift in Gate 7B's actual response shape would fail this test directly.

No browser/Playwright automation was used for this gate; all coverage is
Vitest + Testing Library component/unit tests plus the schema-level contract
smoke test above. This is a documented limitation, not a claim of full
end-to-end browser verification.

## Known limitations of Gate 7C

- Local answers are session-tab-scoped only (`sessionStorage`); they do not
  survive closing the tab/browser, and are not synchronized across tabs or
  devices - by design, since no authoritative persistence exists yet.
- The current-question index is not persisted anywhere; a refresh always
  returns the learner to the first question (their answers, if any, are
  still present from `sessionStorage`).
- No timer display, per the reasoning above.
- No live/manual browser E2E coverage - Vitest/RTL and a schema-level
  contract smoke test only.

# Gate 7D - Authoritative answer submission & exam completion

Gate 7D adds the single authoritative boundary that turns a learner's
in-progress local selections into a permanent, server-recorded submission.
It adds no scoring, no correctness evaluation, no pass/fail, and no
certificate - Gate 7D records what the learner selected; a future gate
evaluates it.

## Submission architecture

`LearnerExamAttemptService.submitAttempt` (same service as `startExam` /
`getAttempt` / `getAttemptQuestions` - Gate 7D extends the existing
exam-session lifecycle service rather than introducing a parallel one,
reusing its ownership-resolution logic instead of duplicating it) is the
**only** place that ever writes an answer or transitions an attempt to
`SUBMITTED`.

## No new answer table - `ExamAttemptQuestion` IS the answer record

Before adding a schema, the existing schema was inspected: `ExamAttemptQuestion`
already carried `selectedOptionId` (FK to `QuestionOption`, `onDelete:
SetNull`), `isCorrect` (nullable `Boolean`), and `answeredAt` (nullable
`DateTime`) - all populated by nothing until now. These were forward-looking
placeholders from Gate 7B's original design specifically for this gate. **No
new `ExamAttemptAnswer` model and no migration were needed or added** - Gate
7D reuses `ExamAttemptQuestion` itself as the authoritative answer record.

This is more than a convenience: because every `ExamAttemptQuestion` row
already exists (created once, atomically, by Gate 7B's `startExam`) and is
uniquely scoped to `(attemptId, questionVersionId)`, the invariant "every
attempt question has exactly one answer record, scoped to exactly one
attempt" holds **by construction** - there is no separate table that could
ever drift out of a 1:1 correspondence, gain a duplicate, or reference the
wrong attempt. Submitting never creates or deletes rows; it only updates
`selectedOptionId`/`answeredAt` on rows that already exist.

`isCorrect` is never read or written anywhere in Gate 7D - it remains `null`
on every row until a future scoring gate.

## Attempt status

`ExamAttemptStatus.SUBMITTED` and `ExamAttempt.submittedAt` already existed
in the schema (populated by nothing until now) - both are reused as-is, no
enum or column changes. `AuditAction.EXAM_SUBMITTED` was likewise already
declared and unused; Gate 7D is its first real caller (mirrors Gate 7B's
reuse of the pre-existing `EXAM_STARTED` action). The only transition Gate
7D performs is `IN_PROGRESS -> SUBMITTED`; it never sets `PASSED`/`FAILED`
(those exist in the enum only as forward-compatible placeholders for a
future scoring gate) and never sets `EXPIRED`/`ABANDONED`.

## Endpoint

`POST /api/learner/exams/attempts/:attemptId/submit` (`LearnerExamsController
.submit`), authenticated, scoped to `@CurrentUser()` exactly like the other
two attempt routes - no `@Roles()` decorator, matching this codebase's
"learner routes touch only the caller's own data" convention.

Request (`SubmitExamDto`, validated by the existing global `ValidationPipe`
with `whitelist`/`forbidNonWhitelisted` - an unknown top-level field, such as
an injected `score`, is rejected with 400 before the handler ever runs):

```json
{ "answers": [{ "attemptQuestionId": "uuid", "selectedOptionId": "uuid | null" }] }
```

The learner never supplies `userId`, `examId`, `examVersionId`, question
order, question count, or any correctness/scoring field - there is no field
for any of these in the DTO to begin with.

Response (`submitExamResponseSchema` in `@gcp/shared`):

```json
{
  "attemptId": "uuid",
  "status": "SUBMITTED",
  "submittedAt": "2026-01-01T00:00:00.000Z",
  "totalQuestions": 20,
  "answeredQuestions": 18,
  "unansweredQuestions": 2
}
```

No score, percentage, pass/fail, marks, correct answer, correctness,
explanation, or certificate field exists in this response shape - not
merely omitted by convention, but absent from the zod schema and the
service's return type, so there is nothing to accidentally leak later.

## Authoritative answer validation

Every submitted answer is checked against the attempt's own persisted
composition, never against anything the browser claims:

1. `attemptQuestionId` must belong to this attempt (looked up from
   `ExamAttemptQuestion` rows loaded by `attemptId`, not trusted from the
   request) - a foreign or invented id, or one copied from another
   learner's attempt, is rejected as `INVALID_EXAM_ANSWER` (400).
2. `selectedOptionId` (when not `null`) must be one of that specific
   question's persisted `ExamAttemptQuestionOption` rows - an option that
   belongs to a _different_ question in the same attempt is rejected the
   same way, even though it is a real, valid option somewhere in this
   attempt.
3. Duplicate `attemptQuestionId` entries in one request are rejected
   wholesale as `DUPLICATE_EXAM_ANSWER` (400) before anything is written -
   never silently resolved by picking the first or last value.

Malformed payloads (wrong types, missing `answers`, non-UUID ids) are
rejected by the existing DTO/`ValidationPipe` machinery, not a bespoke
parser.

## Unanswered-question semantics

The complete question set is derived from `ExamAttemptQuestion`, never from
the size of the request body. Every question the request does not mention
is explicitly persisted as `selectedOptionId: null` (and `answeredAt: null`)

- unanswered is a recorded fact, not an absence of a fact. After a
  successful submission, `count(ExamAttemptQuestion for this attempt)` always
  equals the number of authoritative answer records, because they are the
  same rows.

## Transaction & concurrency

The entire operation - loading the attempt and its questions, validating
every answer, updating every question's `selectedOptionId`/`answeredAt`,
and transitioning the attempt - runs inside one `prisma.$transaction`. The
status transition itself is an atomic, conditional compare-and-swap:

```ts
tx.examAttempt.updateMany({
  where: { id: attemptId, userId, status: 'IN_PROGRESS' },
  data: { status: 'SUBMITTED', submittedAt },
});
```

Postgres's row-level locking under `UPDATE` makes this safe without any
explicit `SELECT ... FOR UPDATE`: two concurrent submissions both matching
`status: 'IN_PROGRESS'` cannot both succeed - the second one's `WHERE`
clause is re-evaluated against the now-committed row and matches zero rows,
so `count === 0`, which is treated as `EXAM_ALREADY_SUBMITTED` and throws
inside the transaction - rolling back every answer write that transaction
had already staged. There is never a window where some answers are
persisted but the attempt is still `IN_PROGRESS`, nor one where the attempt
is `SUBMITTED` but an answer row is missing. Verified against a real
Postgres database by an e2e test firing three concurrent submissions at the
same attempt and asserting exactly one succeeds, the other two get a
deterministic 409, and exactly one `ExamAttempt` row + one audit event
exist afterward.

## Idempotency

Any submission request against an attempt that is not `IN_PROGRESS` -
whether truly concurrent or a plain repeated request after a prior success -
is rejected with `409 EXAM_ALREADY_SUBMITTED`, uniformly, regardless of
whether the payload matches the original submission. The first commit is
authoritative and permanent; nothing about a later request's content is
ever inspected to decide whether to "allow" it once terminal. The submit
endpoint's error response does not itself carry the completion payload -
this is deliberate: the existing `GET .../attempts/:attemptId` (and
`.../questions`) routes are the established, trusted path for authoritative
state, so the frontend reloads through them rather than the submission
response gaining a second, parallel shape for the same information.

## Ownership

Reuses the exact ownership pattern Gate 7B established: the attempt is
resolved by `{ id: attemptId, userId }` in one query, so a non-owned attempt
and a genuinely nonexistent one are indistinguishable - both produce the
same `404 ATTEMPT_NOT_FOUND`. No new `EXAM_FORBIDDEN`/403 path was
introduced for submission, specifically to avoid creating a second way to
confirm another learner's attempt exists.

## Audit logging

Reuses the existing `AuditService` and the pre-existing, previously-unused
`EXAM_SUBMITTED` audit action (see above) - no new audit action was needed.
Following the exact same convention already established by `startExam`
(`AuditService.record` writes via the top-level `PrismaService`, not a
transaction client, and is deliberately called only _after_ the
`$transaction` promise resolves - "audit logging must never break the
primary request flow" is an existing, codebase-wide convention, not
something Gate 7D introduced): a successful submission records exactly one
`EXAM_SUBMITTED` event with `{ totalQuestions, answeredQuestions,
unansweredQuestions }` metadata; a failed validation or a losing concurrent
race throws before that line is ever reached, so no event is recorded for
either. A repeated submission after the attempt is already terminal is
rejected before the transaction even starts, so it likewise never creates a
second event.

## Post-submission immutability

Once `status = SUBMITTED`, no learner API can change answers, add answers,
delete answers, restart the attempt, or change `submittedAt` - the same
`submitAttempt` method is the only write path, and it always re-checks
`status === IN_PROGRESS` first. `GET` routes remain read-only and always
have been. Gate 7C's `sessionStorage` copy is never treated as authoritative
after submission: the frontend overwrites its local answer state with the
server's own recorded `selectedOptionId` values (see below) the moment it
observes `status: SUBMITTED`, and clears the local copy outright.

## `GET` after submission

`examAttemptSummarySchema` gained `submittedAt` (was missing from the Gate
7B DTO); `examAttemptQuestionSchema` gained `selectedOptionId` - the
learner's own persisted selection for that question, or `null`, and nothing
else. This lets `GET .../attempts/:id/questions` remain the single source
the frontend trusts for "what was actually answered," whether that
information came from a fresh submission or a reload of an attempt
submitted earlier (or from another tab/device). Neither addition exposes
`isCorrect`, `correctOptionId`, or any scoring field - those still do not
exist anywhere in the safe payload's shape.

## Learner UI

`ExamNavigation` gained an optional `onSubmit` action, rendered only
alongside the existing last-question review hint - there is still no way to
submit from any other question. Clicking it opens `ExamSubmitDialog`, a
small purpose-built `role="alertdialog"` (no site-wide modal system existed
to reuse) stating the answered/unanswered counts and "After submission,
your answers cannot be changed" - never "passed"/"failed"/"score", since
Gate 7D has no scoring. Confirming calls `learnerExamApi.submitExamAttempt`
(added to the existing `learner-exam-api.ts` client - no new HTTP client;
`startExam` is still deliberately not exposed here).

Submission UI states live in `useExamAttempt`'s `submission` field (`idle`,
`submitting`, `error`, `conflict`), separate from the page's `ExamLoadState`:

- **submitting**: the confirm button disables itself and shows
  "Submitting…"; a re-entry guard inside the hook's `submit()` also ignores
  a second call while one is already in flight, so rapid double-clicks can
  never produce two requests even if a click somehow got through before the
  button's own `disabled` attribute took effect.
- **success**: `sessionStorage` for this attempt is cleared **only now**,
  never speculatively before the server confirms success, and never for
  unrelated attempts (only this attempt's own namespaced key is removed).
  The hook then calls the same `reload()` used everywhere else in this
  file, re-fetching both `GET`s through the exact same trusted path rather
  than constructing the locked view from the submit response alone.
- **conflict (409)**: local answers are left untouched (never blindly
  overwritten on failure) and the same `reload()` runs, so the authoritative
  `SUBMITTED` state - and the actual recorded answers, from whichever
  request really won the race - takes over.
- **error** (network/5xx): the dialog stays open with a plain, non-technical
  message and the previously-selected local answer is preserved unchanged,
  so the learner can retry the exact same submission without re-selecting
  anything or losing work; nothing here ever claims success it did not
  observe.

## Post-submission lock

Once `attempt.status === 'SUBMITTED'` (whether from a fresh success or from
loading an already-submitted attempt, e.g. after a refresh), the exam route
renders **only** `ExamSubmittedSummary` - no question card, no palette, no
navigation, no submit control at all, not merely a disabled one. This is
driven entirely by the server-reported status on every load, so refreshing
can never regain editing ability: there is no code path that renders the
interactive exam UI without `attempt.status !== 'SUBMITTED'` being true.
(`QuestionCard` also gained a `disabled` prop that locks every radio input
at the DOM level, kept as defence in depth even though the submitted branch
never actually mounts it.) The summary reports only questions/answered/
unanswered/`submittedAt` and closes with the neutral "Your submission has
been recorded." - never "Results will be available after evaluation" or any
wording that implies scoring timing this gate cannot promise.

The `beforeunload` warning from Gate 7C is now conditioned on
`!isSubmitted` as well as `answeredCount > 0` - there is nothing left to
warn about once the server has recorded the submission.

## Timer / expiration

Not touched. `ExamVersion.durationMinutes` and `ExamAttempt.expiresAt`
remain populated-but-unenforced exactly as Gate 7B left them; Gate 7D adds
no expiration check and no pseudo-enforcement. Expiration enforcement
remains explicit future scope.

## Security boundary

- All answer validation resolves against the persisted attempt composition
  loaded server-side inside the transaction - never against anything the
  client asserts about question/option identity.
- `userId` is taken only from the authenticated session; the request body
  has no field for it.
- `submittedAt` is always `new Date()` computed server-side inside the
  transaction; the DTO has no field for it, so there is nothing for a
  client to control even accidentally.
- No `isCorrect`/`correctOptionId`/`answerKey`/`explanation`/score/
  percentage/pass-fail field exists anywhere in the request or response
  contracts, and none is computed anywhere in this code path.
- No AI provider, generation service, or candidate data participates in
  submission.
- No certificate is created, issued, or made eligible.

## Testing

**Backend unit** (`learner-exam-attempt.service.spec.ts`, 13 new tests):
successful submission with a full authoritative answer record per question,
`isCorrect` never included in any update payload, fully-unanswered
submission, the atomic status-guarded update, exactly-one audit event on
success, `ATTEMPT_NOT_FOUND` for a non-owned/missing attempt (no audit, no
question query), `EXAM_ALREADY_SUBMITTED` / `EXAM_NOT_IN_PROGRESS` for
already-terminal attempts, `INVALID_EXAM_ANSWER` for a foreign
`attemptQuestionId`, an option belonging to a different question in the
same attempt, and an invented option id, `DUPLICATE_EXAM_ANSWER` before any
database write, and a simulated concurrent-race compare-and-swap failure
mapping to `EXAM_ALREADY_SUBMITTED` with no audit event.

**Backend E2E** (`learner-exam-submission.e2e-spec.ts`, 23 new tests, real
Postgres): partial and fully-unanswered submissions, exactly one answer row
per attempt question, exactly one audit event, no score/percentage/pass-
fail/correctness/certificate anywhere in the submit response or a
post-submission `GET`, every answer-validation rejection (foreign option,
invented option, foreign `attemptQuestionId`, another learner's
`attemptQuestionId`, duplicate entries, malformed payload, unknown
top-level field, injected `isCorrect`/`score` fields), unauthenticated and
non-owner submission (indistinguishable 404), nonexistent and malformed
attempt ids, a second submission rejected without mutating the recorded
answers or `submittedAt` and without a second audit event, three concurrent
submissions resolving to exactly one success and two deterministic 409s,
and a full data-integrity check that every row stays scoped to its own
attempt.

**Frontend** (`page.test.tsx`, 10 new tests under "Gate 7D: submission"):
the confirmation dialog's counts and irreversibility copy, Cancel and
Escape both closing without submitting, initial focus and
`alertdialog`/`aria-labelledby`/`aria-describedby` semantics, a full
success path asserting the exact request payload, the locked summary
render, and `sessionStorage` clearing, rapid double-clicks producing
exactly one request, a network failure that preserves local answers and
allows an in-place retry from the same dialog, a 409 that reloads into the
locked state without overwriting the authoritative answer, loading directly
into the locked summary with no editable controls at all (the refresh
case), and an explicit sweep of the submitted summary's HTML for
score/percentage/pass-fail/correctness/certificate text.

**Contract tests** (`contracts.test.ts`, 9 new tests): `submitExamRequestSchema`
accepts a selection, an explicit `null`, and an empty `answers` array;
rejects a non-UUID `attemptQuestionId`/`selectedOptionId`; and its parsed
shape never contains a score/correctness/pass-fail substring.
`submitExamResponseSchema` accepts a well-formed completion payload, rejects
any `status` other than the literal `SUBMITTED`, and likewise never
contains a score/percentage/pass-fail/certificate substring.

No browser/Playwright automation was used for this gate. Playwright's
Chromium binary happens to be installed in this environment, but no prior
gate has ever assembled the full-stack harness (API + Postgres + a running
Next.js server + seeded exam data + authenticated browser session) a real
end-to-end run would need, and building that harness for the first time was
judged out of scope for a gate whose mandate is the submission mechanism
itself, not new test infrastructure. Coverage is Vitest + Testing Library
for the UI, and real-Postgres Jest/Supertest e2e tests for the API -
including the concurrency test, which exercises actual Postgres row-locking
behavior, arguably a more rigorous proof of this gate's core atomicity claim
than a scripted browser click-through would be. This limitation is
unchanged from every prior gate's own disclosure.

## Known limitations of Gate 7D

- No timer/expiration enforcement - explicitly deferred, matching Gate 7B.
- No real-time cross-tab synchronization: if an attempt is submitted from
  another tab or device, this tab only learns of it on its next server
  interaction (a submit attempt, or a manual reload), not instantly.
- No browser/Playwright E2E run, for the reasons given above.
- Once terminal, a submission cannot be un-submitted through any learner
  API - by design; no such capability exists in this codebase.

# Gate 7E - Authoritative scoring, pass/fail & result finalization

Gate 7E evaluates a finalized, already-SUBMITTED examination attempt. **It
does not issue certificates** - passing establishes a factual prerequisite a
future gate may act on, nothing more.

## Scoring architecture

`LearnerExamScoringService` (`learner-exam-scoring.service.ts`) is the
**only** place in the codebase that ever evaluates an attempt or transitions
`ExamAttempt.status` to `PASSED`/`FAILED` - confirmed by a repository-wide
audit before this gate was considered complete (see below). It is
deliberately a separate service from `LearnerExamAttemptService` (unlike
Gate 7D's submission logic, which extended the existing lifecycle service):
scoring reads an entirely different part of the schema - the historical
`QuestionVersion`/`QuestionOption` answer key - that no other learner-exam
code path touches, and keeping it isolated from question
selection/generation/certificate concerns was an explicit spec requirement.

## No new result table - `ExamAttempt` already had almost everything

Before writing any code, the existing schema was inspected. `ExamAttempt`
already carried `correctCount` (`Int?`), `scorePercent` (`Decimal(5,2)?`),
and `passed` (`Boolean?`) - unpopulated forward-looking placeholders from
Stage 2/Gate 7A's original design, exactly like Gate 7B/7D's own
placeholders had been. Only one column was genuinely missing: `evaluatedAt`.
One additive migration
(`20261020000000_gate7e_exam_result_finalization`) adds it, plus the new
`EXAM_EVALUATED` audit action value - no `DROP`, no destructive change, no
new table.

**No separate `resultStatus` column was added.** `PENDING` vs `FINALIZED`
is fully and unambiguously derivable from existing state: `status ===
SUBMITTED` means pending, `status ∈ {PASSED, FAILED}` means finalized (and
`evaluatedAt` is non-null exactly when, and only when, that is true - it is
set atomically with the status transition and never independently). Adding
a redundant status enum alongside two fields that already encode the same
information would have violated "prefer the smallest coherent data model."

**`correctCount`** is reused for its literal meaning - a count of correctly
answered questions (e.g. `17`), not a marks-based score. The marks-based
`rawScore` the API returns (e.g. `85`) is computed on demand as
`correctCount * examVersion.marksPerQuestion` wherever needed, never
persisted separately: since `ExamVersion` rows are immutable once they
leave `DRAFT` (Gate 7A), this recomputation is always exactly reproducible
and storing it again would be pure redundancy.

**`ExamAttemptQuestion.isCorrect`** (a nullable column Gate 7B created and
Gate 7D explicitly left untouched) is now populated, once, during
evaluation - never during submission, never editable by any learner API.
This was a deliberate choice, not a requirement: the response never needs
per-question correctness (the spec's own default is a summary-only result),
but the field already existed for exactly this purpose, and leaving it
permanently `null` despite that would have been a stranger outcome than
finishing what Gate 7B started. It plays no role in computing the summary
result returned to the learner (`answeredQuestions` is derived fresh from
`selectedOptionId`, `correctCount` is read directly), so nothing depends on
it existing.

## Historical `ExamVersion` and `QuestionVersion` handling

Every scoring input is resolved from the attempt's own persisted
references, never from "current" state:

- `ExamVersion.marksPerQuestion` / `totalMarks` / `passPercentage` are read
  via `attempt.examVersionId` - the specific version the attempt was
  created against - never via `exam.activeVersionId`. Because a non-DRAFT
  `ExamVersion` is never edited in place (editing forks a new version, per
  Gate 7A), this is guaranteed stable for the life of the attempt.
- The answer key comes from `QuestionOption` rows filtered by
  `questionVersionId`, using the **exact** `questionVersionId` stored on
  each `ExamAttemptQuestion` row - never `Question.currentPublishedVersionId`.
  If the question bank is edited and republished after an attempt started
  (forking a new `QuestionVersion` per Stage 6), the old version's options -
  and therefore its answer key - are never touched, so the historical
  attempt keeps scoring against the answer key the learner actually saw.
  Verified by a real-Postgres e2e test: republish a question with its
  correct answer flipped, then confirm an attempt started before the
  republish still scores against the original key.

## Scoring algorithm

Per `ExamAttemptQuestion`: `selectedOptionId === null` or `selectedOptionId
!== correctOptionId` both score zero; `selectedOptionId === correctOptionId`
scores `marksPerQuestion`. Correctness is decided by **option identity**
only - the algorithm never looks at `ExamAttemptQuestionOption`
(presentation order) or array position, only at `QuestionOption.id`.
Verified by a unit test that shuffles the mocked option array and confirms
the result is unchanged. No partial credit; no negative marking (nothing in
the schema or spec authorizes it, so none was invented).

```
rawScore   = correctCount * marksPerQuestion
percentage = round2(rawScore * 100 / totalMarks)
passed     = percentage >= examVersion.passPercentage
```

`marksPerQuestion`/`totalMarks`/`passPercentage` all come from the
historical `ExamVersion` - there is no hard-coded `80` anywhere in the
scoring code. Verified by an e2e test using a `40%` threshold, where a score
that would fail under the "typical" 80% default explicitly passes.
`round2` uses `Math.round(x * 100) / 100` (round-half-up, exact for the
non-negative values a score can ever be) - the same value is returned
byte-for-byte to the frontend, which never re-rounds or recalculates it.

## Status transitions

The only transition this gate performs is `SUBMITTED -> PASSED` or
`SUBMITTED -> FAILED`. `IN_PROGRESS -> PASSED/FAILED` and any transition
away from a terminal state are structurally impossible: every write is a
conditional `updateMany` guarded by `status: SUBMITTED` in its `WHERE`
clause (see Concurrency below), and no other code path anywhere in the
repository writes `PASSED` or `FAILED` (confirmed by the repository audit).

## Result finalization & transaction behaviour

Loading the attempt questions, resolving the answer key, validating
integrity, evaluating, persisting per-question `isCorrect`, and the
`SUBMITTED -> PASSED/FAILED` transition all happen inside one
`prisma.$transaction` - mirroring Gate 7D's own submission transaction
exactly. Any failure rolls back every write in that transaction; there is
never a state with some `isCorrect` values persisted but the attempt still
`SUBMITTED`, nor `PASSED`/`FAILED` with a missing `evaluatedAt`.

## When evaluation actually runs - "evaluate on read"

There is no background job or queue anywhere in this codebase, so
evaluation is triggered **lazily, synchronously, by the first `GET
.../result` call** that observes a `SUBMITTED`-but-unevaluated attempt -
not automatically chained onto Gate 7D's submit endpoint. This was a
deliberate choice: chaining evaluation into `submitAttempt` would leave
every attempt that reached `SUBMITTED` _before_ Gate 7E existed permanently
un-scoreable (nothing would ever trigger it), and it would also make
genuine concurrent-evaluation races effectively untestable, since Gate 7D's
own submission already guarantees only one caller can ever reach
`SUBMITTED` for a given attempt. Evaluating lazily on the read path means:

- The very first `GET .../result` for a freshly-submitted attempt already
  returns the finalized result immediately (evaluation completes well
  within that one request) - there is no visible "processing" delay in the
  normal case.
- Any attempt that was already `SUBMITTED` under Gate 7D, from before Gate
  7E shipped, is scoreable the first time anyone asks for its result.
- Two learners' browser tabs (or two rapid reloads) hitting `GET
.../result` on the same never-yet-evaluated attempt at the same moment is
  a real, reachable race - not a hypothetical one - so the concurrency
  guarantees below are actually exercised, not vacuously true.

This does mean a `GET` request can cause a write. That is a deliberate,
documented departure from strict REST purity, justified because evaluation
is a **pure, idempotent function of already-immutable inputs** (the
historical `ExamVersion`, the historical answer key, the learner's own
already-submitted selections) - calling it any number of times, from any
number of concurrent callers, can only ever reproduce the same result,
never a different one. Nothing about the "same submitted attempt always
produces the same result" requirement is at risk from this choice.

## Idempotency

Once `status ∈ {PASSED, FAILED}`, `getOrEvaluateResult` takes a pure,
read-only path (`toFinalizedView`): no transaction, no write, no audit
event, regardless of how many times it is called. Verified by a unit test
calling it twice and asserting `transaction`/`auditRecord` were never
invoked, and an e2e test asserting a second `GET` returns a body identical
to the first (including `evaluatedAt`) and that exactly one
`EXAM_EVALUATED` audit row exists in the database afterward.

## Concurrency

The `SUBMITTED -> PASSED/FAILED` write is an atomic conditional
`updateMany` guarded by `status: SUBMITTED`, exactly mirroring Gate 7D's
own compare-and-swap pattern and relying on the same Postgres row-locking
guarantee: two concurrent evaluators racing on the same attempt cannot both
succeed. The loser's `updateMany` affects zero rows (its transaction is
rolled back, discarding its otherwise-harmless duplicate `isCorrect`
writes), and it re-reads and returns the winner's already-committed,
already-finalized result rather than erroring - the caller never sees a
conflict, only ever the one true result. Verified by a real-Postgres e2e
test firing three concurrent `GET .../result` requests at a freshly-
submitted attempt and asserting: all three responses are byte-identical,
the attempt ends up in exactly one terminal status, and exactly one
`EXAM_EVALUATED` audit event exists.

## Answer, question, and answer-key immutability

Evaluation never writes `selectedOptionId`, `attemptQuestionId`,
`questionVersionId`, option order, or question order - it only ever writes
`ExamAttemptQuestion.isCorrect` and the `ExamAttempt` result columns.
`QuestionVersion`/`QuestionOption` (the answer key) are never written by
this service at all - only ever read. Verified by an e2e test that
snapshots every relevant row before and after calling `GET .../result` and
asserts they are unchanged except for the two fields evaluation is
authorized to touch.

## Integrity validation

Before trusting any computed score, evaluation checks, per attempt: the
persisted question count matches `ExamAttempt.totalQuestions`; every
question version has **exactly one** authoritative correct option; and any
non-null `selectedOptionId` actually belongs to that question's option set
(a defence-in-depth re-check - Gate 7D already validated this at submission
time, but evaluation does not blindly trust it either). If any check fails,
evaluation does **not** produce a score, a `PASSED`/`FAILED` status, or any
write at all - the failure is logged server-side (naming only the
_category_ of problem, e.g. "question version does not have exactly one
authoritative correct option" - never a `correctOptionId`, a selected
answer, or any other sensitive value) and the attempt remains `SUBMITTED`.

**Design decision:** the learner-facing response for this case is the same
safe `PENDING` shape used before any evaluation attempt, not a raw error -
"submitted, not yet evaluated" is literally true whether evaluation was
never attempted or was attempted and failed safely, and surfacing an
internal data-integrity problem directly to a learner would be both
alarming and unhelpful. The dedicated `EXAM_RESULT_INTEGRITY_ERROR` error
code is still defined in `ExamAttemptErrorCode` (per the spec's own
recommendation and for future admin-tooling use) but is not, by this
gate's design, ever returned over the learner-facing result endpoint.

## Result API

`GET /api/learner/exams/attempts/:attemptId/result` - authenticated, scoped
to `@CurrentUser()`, ownership resolved by `{id, userId}` exactly like
every other Gate 7B/7D attempt route (a non-owned attempt is
indistinguishable from a nonexistent one: `404 ATTEMPT_NOT_FOUND`). A plain
`GET` with **no request body at all** - there is structurally no field for
a client to submit a score, percentage, pass/fail, or evaluation timestamp
through, satisfying the tamper-resistance requirement by construction
rather than by validation.

- `IN_PROGRESS` (or the unreachable `EXPIRED`/`ABANDONED`) -> `409
EXAM_NOT_SUBMITTED`.
- `SUBMITTED`, not yet evaluated -> evaluates now (see above), returns
  `FINALIZED`, or (integrity failure only) `PENDING`.
- `PASSED`/`FAILED` -> returns the persisted `FINALIZED` result, read-only.

Finalized response (`examAttemptResultFinalizedSchema`):

```json
{
  "attemptId": "uuid",
  "status": "PASSED",
  "resultStatus": "FINALIZED",
  "rawScore": 85,
  "totalMarks": 100,
  "percentage": 85,
  "passPercentage": 80,
  "evaluatedAt": "2026-01-01T00:00:00.000Z",
  "totalQuestions": 20,
  "answeredQuestions": 18,
  "unansweredQuestions": 2
}
```

Pending response (`examAttemptResultPendingSchema`):

```json
{ "attemptId": "uuid", "status": "SUBMITTED", "resultStatus": "PENDING" }
```

Neither shape has a field for a correct answer, an answer key, per-question
correctness, reviewer information, or blueprint internals - by default,
this gate never returns per-question correctness at all, matching the
spec's explicit "summary result only" instruction.

## Learner UI

No new route was created. Per the spec's own "do not create a separate
page if existing route architecture can cleanly support the result state"
guidance, `/exams/attempts/[attemptId]` (Gate 7C/7D's existing route) was
extended: once the attempt is no longer `IN_PROGRESS`, a new
`ExamResultPanel` renders beneath Gate 7D's existing `ExamSubmittedSummary`,
backed by a new `useExamResult` hook that fetches `GET .../result` only
once `useExamAttempt`'s `isSubmitted` flag is true (calling it any earlier
would just get a `409`). The panel renders exactly one of three states,
driven entirely by the server response's own `resultStatus`/`status`
fields - never independently computed:

- **Pending**: "Your exam has been submitted and is awaiting evaluation."
  Never a score, never "Failed", never an inferred outcome.
- **Finalized**: "Passed" or "Not passed" - the heading text itself carries
  the outcome (never color alone; the `Badge` gained a `danger` tone for
  "Not passed", but the label is the primary signal). Shows score
  (`rawScore / totalMarks`), percentage, the passing threshold, question/
  answered/unanswered counts, and the evaluation timestamp - all rendered
  verbatim from the response. No congratulatory or exaggerated language, no
  certificate or accreditation claim.
- **Error**: the existing `ExamErrorState` component, reused as-is, with a
  retry action for network/server failures.

The header status badge prefers the result's own `status` once `FINALIZED`
over `attempt.status` (which can still read `SUBMITTED` for the rest of
that page view, since evaluation happens inside the result fetch, not via a
separate attempt reload) - so the badge reflects `Passed`/`Not passed`
immediately once evaluation completes, without an extra round trip.

## Frontend/server boundary

The frontend performs **no** scoring calculation anywhere - `rawScore`,
`percentage`, `passPercentage`, and `status` are rendered exactly as
received, with no arithmetic, no threshold comparison, and no `if (score >=
80)`-style logic in any component. Verified by a test that feeds the panel
a deliberately "inconsistent" result (a `percentage` that would not
actually follow from `rawScore`/`totalMarks` if recomputed) and asserts the
displayed value is the server's value unchanged - proving nothing
client-side is recalculating it.

## Audit logging

Reuses the existing `AuditService`; a new `EXAM_EVALUATED` action was added
(no pre-existing unused placeholder existed for it, unlike `EXAM_STARTED`/
`EXAM_SUBMITTED`). Recorded, exactly once, only by the request that
actually performs the SUBMITTED -> PASSED/FAILED transition - never for a
request that merely reads an already-finalized result, never for a request
that loses a concurrent race, and never for an integrity failure. Metadata
is limited to `{status, totalQuestions, answeredQuestions}` - no answer
key, no selected answers, no per-question correctness.

## Security boundary

- Every scoring input is resolved server-side from the attempt's own
  persisted references; the result endpoint has no request body at all.
- `evaluatedAt` is always `new Date()` computed inside the transaction -
  there is no field anywhere for a client to set it.
- No `correctOptionId`/answer key/per-question correctness is returned by
  the result endpoint, logged, or included in any exception message or
  audit metadata.
- No AI provider, generation service, or candidate data participates in
  evaluation - the algorithm is a small, fully deterministic, auditable
  function.
- No certificate is created, issued, or made eligible by this gate.

## Repository audit (performed before declaring this gate complete)

- Every write to `ExamAttempt.status` in the repository: exactly two sites
  - `learner-exam-attempt.service.ts` (`IN_PROGRESS -> SUBMITTED`, Gate 7D)
    and `learner-exam-scoring.service.ts` (`SUBMITTED -> PASSED/FAILED`,
    this gate). No third site exists anywhere, admin or learner.
- Every reference to `PASSED`/`FAILED` outside this gate's own files: none
  found in application code (only in this gate's docstrings and the
  pre-existing enum declarations).
- Every write to `ExamAttemptQuestion.isCorrect`: exactly one site, this
  gate's `evaluateAndFinalize`. Gate 7D's submit path never touches it.
- Every `currentPublishedVersionId` reference in a _learner-facing_ code
  path: none - the only mention inside `learner-exam-scoring.service.ts` is
  a documentation comment stating it is deliberately never used.
- Every `GET .../result`-shaped endpoint: exactly one, on
  `LearnerExamsController`.
- Every certificate-creation code path in the repository: none exist -
  confirming no Gate 8 work has started.

## Testing

**Backend unit** (`learner-exam-scoring.service.spec.ts`, 27 tests):
ownership/status gating (`ATTEMPT_NOT_FOUND`, `EXAM_NOT_SUBMITTED` for
`IN_PROGRESS`/`EXPIRED`/`ABANDONED`), pure reads for already-`PASSED`/
`FAILED` attempts (no transaction, no audit), the scoring algorithm
(correct/incorrect/unanswered, exact-threshold pass, just-below-threshold
fail, a realistic 20-question/100-mark exam, option-order independence,
historical-version-id usage, no partial/negative credit), persistence
(`isCorrect` per question, the status-guarded atomic update never touching
`selectedOptionId`, server-controlled `evaluatedAt`, exactly-one audit
event with no answer-key content), idempotency and a simulated concurrent-
race loss, and every integrity-violation branch (question-count mismatch,
zero/multiple correct options, foreign selected option) returning `PENDING`
without any write.

**Backend E2E** (`learner-exam-result.e2e-spec.ts`, 17 tests, real
Postgres): the full deterministic test matrix from the spec (20/20 = 100%
pass, 16/20 = exactly-80% pass, 15/20 = 75% fail, 0/20 = 0% fail, a
non-default 40% threshold, partially and fully unanswered submissions), the
historical-QuestionVersion answer-key test (republish with a flipped
correct answer, confirm the original key still applies), result-access
gating (`409` for `IN_PROGRESS`, unauthenticated, non-owner, nonexistent,
malformed id), idempotent repeated retrieval with exactly one audit event,
a genuine 3-way concurrent-evaluation race producing one result, an
answer-key/correctness leakage sweep, and a full immutability snapshot
(submitted answers, question composition, and the answer key all
byte-identical before and after evaluation).

**Frontend** (`page.test.tsx`, "Gate 7E: result", 8 tests): no result fetch
while `IN_PROGRESS`; the pending message (never a score, never "Failed");
the finalized `PASSED` and `FAILED` ("Not passed") renders with every field
displayed verbatim; the no-client-side-scoring proof described above; a
retryable error state; and accessible `role="status"` on the result panel.

**Contract tests**: covered by the shared `@gcp/shared` build/typecheck
(the discriminated `examAttemptResultSchema` union itself is exercised
transitively by every e2e test that parses a real response through it, and
by the frontend's `authenticatedJson` call in `use-exam-result.ts`) and by
the e2e leakage-sweep test asserting the finalized shape carries no
forbidden field.

No browser/Playwright automation was used, for the same reasons disclosed
in Gate 7C/7D: no full-stack harness (API + Postgres + a running Next
server + seeded data + an authenticated browser session) exists in this
project, and assembling one for the first time was judged out of scope for
a gate about scoring correctness, not test infrastructure. The real-
Postgres concurrency e2e test is, if anything, a more rigorous proof of
this gate's core atomicity claim than a scripted browser click-through
would be.

## Known limitations of Gate 7E

- Evaluation is lazy (triggered by the first result read), not eager at
  submission time - a deliberate, documented choice (see above), not an
  oversight.
- No per-question correctness is ever returned to the learner - only a
  summary result, matching the spec's explicit default.
- No timer/expiration enforcement - unchanged from Gate 7B/7D.
- No admin-facing result inspection endpoint was added - none existed
  before this gate, and none was required by the spec ("only ensure the
  authoritative result can be inspected... if already supported").
- No certificate, certificate eligibility calculation, or Gate 8 work of
  any kind was started.

# Gate 8 - Certificate engine

Full documentation lives in [`docs/certificate-engine.md`](./certificate-engine.md).
Summary of the boundary with this document's own gates:

- Gate 8 issues a `Certificate` only from an `ExamAttempt` that is
  `status === PASSED` with an internally-consistent, Gate-7E-finalized
  result (`passed`, `scorePercent`, `evaluatedAt` all populated and
  consistent) - it never recalculates a score or re-derives pass/fail.
  `LearnerExamScoringService` remains the sole writer of `PASSED`/`FAILED`
  anywhere in the codebase (re-confirmed by a repository-wide audit).
- Gate 8 also requires authoritative Gate 5 training completion
  (`TrainingStateComputer`, reused - not re-derived) in addition to the
  exam result; passing the exam alone is not sufficient.
- Certificates are their own historical artifact
  (`certificateNumber`/`verificationCode`/name-and-score snapshots) - Gate
  8 never stores certificate data inside `ExamAttempt`, and this document's
  models are never written to by the certificate engine.
- No exam engine logic (question selection, submission, scoring, pass/fail
  calculation) was modified to build Gate 8.
