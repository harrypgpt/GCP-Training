# Controlled Question Bank Expansion & Exam Blueprint Foundation (Gate 22)

## 1. Objective

Gate 22 has two independent deliverables built on top of Gate 21's completely
unmodified quality-review layer:

- **(A) Question promotion** - a controlled, defense-in-depth gate
  (`QuestionPromotionService`) between an `ACCEPTED` `AiQuestionCandidate`
  and the real question bank, sitting _in front of_ the existing
  `AiCandidateConversionService.convert()` rather than replacing it.
- **(B) Exam blueprint structural foundation** - volume limits and a
  shortfall-aware coverage report layered onto the exam-blueprint
  architecture that Stage 7A had already built, plus a new, admin-only
  Question Bank Readiness Report.

Nothing in this gate selects exam questions, runs an exam, scores an
attempt, issues a certificate, generates AI content, or introduces
embeddings/RAG. Every promoted question lands as `DRAFT` - never published.

## 2. Architecture inspected before writing anything

Before coding, the existing Stage 7A exam-blueprint architecture was
inspected and found far more complete than the gate's own prompt implied:
`ExamBlueprintService` (create/replace/get), `ExamBlueprintValidationService`
(a 20-point deterministic checklist), `ExamBlueprintCoverageService`
(`analyze(examVersionId)`), `ExamQuestionEligibilityService`, and a full
ADMIN-only CRUD controller with `/blueprint`, `/blueprint/validate`,
`/blueprint/coverage` routes. Gate 22 **extended** this architecture (volume
limits, shortfall fields) rather than duplicating it, per the gate's own
"do not invent architecture that already exists" instruction. The existing
`DifficultyLevel` enum (`EASY`/`MEDIUM`/`HARD`/`EXPERT`) was reused as-is.

## 3. Question promotion implementation

`QuestionPromotionService.promote(candidateId, actorId)`:

1. Loads the candidate (`AiCandidatesService.get`).
2. Returns the deterministic `CANDIDATE_ALREADY_CONVERTED` error, without
   calling `convert()`, if `convertedQuestionId` is already set (idempotent).
3. Requires `status === 'ACCEPTED'` (`INVALID_CANDIDATE_TRANSITION`
   otherwise).
4. Requires a recorded `AiCandidateQualityReview` with `decision === 'ACCEPT'`
   (`QUALITY_REVIEW_REQUIRED` otherwise - covers "no review" and "review was
   REJECT" identically).
5. Re-evaluates the **stored** review's `qualityDimensions` against the
   mandatory-dimension gate, and re-runs a **fresh** duplicate check against
   the current database state (`QUALITY_REVIEW_GATE_FAILED` on either
   failure) - see §4.
6. Re-checks the candidate's own persisted `qualityReport.valid` and
   `qualityReport.governance.valid` (`DETERMINISTIC_VALIDATION_NOT_PASSED`
   otherwise) - see §5.
7. Re-checks provenance completeness (§6).
8. Delegates the actual conversion to the existing, unmodified
   `AiCandidateConversionService.convert()`.
9. Records a distinct `AI_CANDIDATE_PROMOTED_TO_QUESTION` audit event.

Promotion never re-implements conversion logic - it only adds a
defense-in-depth gate in front of it, so Gate 21's and Gate 22's checks
cannot silently drift apart (see §4).

## 4. Governance controls (defense in depth)

Gate 21's `AiCandidateQualityReviewService` already gates `ACCEPT` behind a
mandatory-dimension check and a duplicate check **at review time**. Gate 22
does not trust that check to remain valid forever - time may pass between
review and promotion, and a new colliding candidate may appear. Both checks
were extracted into one shared utility,
`apps/api/src/modules/ai/candidate-duplicate-check.util.ts`
(`findCandidateDuplicates`, `evaluateMandatoryQualityGate`), consumed
identically by the review service and the promotion service, so the two
gates can never diverge. A dedicated unit test proves the fresh-duplicate
case: a candidate whose review passed cleanly is refused at promotion time
once a colliding candidate is manually inserted afterward.

## 5. Deterministic validation reuse

Rather than reconstructing a `GroundingContext` to re-run
`validateAiQuestionOutput`/`validateQuestionGovernance` at promotion time (no
benefit, since these validators are pure functions of data already captured
at generation time), `assertDeterministicValidationPassed()` simply checks
the candidate's own immutable, already-persisted `qualityReport.valid` and
`qualityReport.governance.valid` fields.

## 6. Provenance requirements

- Every candidate requires `normativeSource` and `normativeSourceSection`
  (`NORMATIVE_GROUNDING_MISSING` otherwise) - both generation types are
  grounded in ICH E6(R3), never in FDA/audit evidence alone.
- `CASE_APPLICATION` candidates additionally require `scenarioSourceType`
  (not `'NONE'`) and `caseStudyVersion` (`NORMATIVE_SOURCE_INVALID`
  otherwise).
- `DIRECT_GCP` candidates do **not** require scenario/case-study provenance
  (verified with a dedicated unit test).

## 7. A real traceability bug found and fixed

While building promotion, real Gate 21 conversions were inspected and found
to have silently lost traceability: `AiCandidateConversionService.convert()`
never mapped `candidate.normativeSourceSectionId` onto the existing (but
previously unused) `QuestionVersion.sourceSectionRefId` FK, never mapped
`candidate.questionGenerationType` (column added this gate, reusing the
existing enum), and only checked the old `caseStudyLinks` many-to-many table
for case-study references - which is always empty for any Gate 17+ candidate
generated via the newer single `caseStudyVersionId` FK. Every Question
converted from a Gate 18+ candidate lost its real ICH E6(R3) section
reference, its DIRECT_GCP/CASE_APPLICATION classification, and its
case-study link at the moment of conversion. This was empirically confirmed
on a real Gate 21 conversion (`GCP-Q-001046`, `sourceSection: null`) and
fixed by (1) adding the `questionGenerationType` column, (2) mapping
`sourceSectionRefId`/`questionGenerationType` in the create DTO, and (3)
merging `caseStudyIds` from both the legacy join table and
`caseStudyVersion.caseStudyId`. Re-verified fixed on a real Gate 22
promotion (`GCP-Q-001182`: `sourceSectionRefId` now resolves to real ICH
Section 2.5, `questionGenerationType` is `CASE_APPLICATION`, and
`caseStudyLinks` now shows the real case study).

## 8. Blueprint model (reused, not duplicated)

The blueprint model (name/description/`trainingProgramId`/version/status/
`totalQuestions`/`passingScorePercentage`) and blueprint rules
(domain/questionType/difficulty/learningObjective/professionalRole/
`requiredQuestionCount`-equivalent fields) already existed from Stage 7A as
`ExamBlueprint`/`ExamBlueprintRule`. Gate 22 added exactly two things: a
server-side cross-rule volume ceiling and per-rule/overall shortfall
reporting (§9-10).

## 9. Coverage calculation (extended, not rebuilt)

`ExamBlueprintCoverageService.analyze(examVersionId)` already computed
`eligiblePool`/`sufficient` per rule and `feasible` overall. Gate 22 added:

- `RuleCoverage.required` = `exactCount ?? minimumCount ?? 0`.
- `RuleCoverage.shortfall` = `max(0, required - eligiblePool)`.
- `BlueprintCoverageResult.questionCountShortfall` =
  `max(0, questionCountRequired - eligiblePoolSize)`.

This remains a pure, read-only, inventory-style report. It never selects or
reserves questions for a future exam attempt.

## 10. Volume limits

Added at the DTO layer (`@Max(MAX_REQUIRED_QUESTIONS_PER_RULE)` = 100 on
`minimumCount`/`maximumCount`/`exactCount`, alongside the pre-existing
`@ArrayMaxSize(100)` = `MAX_BLUEPRINT_RULES` and pre-existing `@Min(0)`) and
at the service layer (`assertVolumeLimits()` in `ExamBlueprintService`,
enforcing `MAX_TOTAL_REQUIRED_QUESTIONS = 500` as a cross-rule sum), wired
into both `create()` and `replace()`. Both limits are proven by real e2e
requests against a real ADMIN token and a real training-program/exam
fixture - not an RBAC-masking 403.

## 11. Question Bank Readiness Report

`QuestionBankReadinessService.getSummary()` (admin-only,
`GET /api/admin/questions/readiness`) returns question counts broken down by
review status, generation type, difficulty, domain, learning objective, and
professional role, plus a per-blueprint `READY`/`INSUFFICIENT`/
`REQUIRES_REVIEW` status (never a numerical score) derived from the
unmodified `ExamBlueprintCoverageService`. During final verification this
endpoint was found to be reachable by `CONTENT_AUTHOR`/`REVIEWER` as well as
`ADMIN` (`READ_ROLES`), contradicting the gate's own "admin-only" wording -
fixed to `@Roles([UserRole.ADMIN])`, with the e2e test corrected to assert a
`REVIEWER` gets `403`.

## 12. A second real gap found and fixed: shared-contract field stripping

While building the admin UI, the shared zod contracts
(`ruleCoverageSchema`/`blueprintCoverageResultSchema`) were found to still
match the pre-Gate-22 shape - missing `required`/`shortfall`/
`questionCountShortfall`. Because the web client parses every response
through these schemas (`z.object()` strips unknown keys by default), the
real, correct backend fields were being **silently dropped before reaching
the browser** on every blueprint-coverage request. Fixed by adding the three
fields to the shared schemas and rebuilding `@gcp/shared`. A `readiness`
contract (`questionBankReadinessSummarySchema` + `ADMIN_QUESTION_ROUTES.readiness`)
was also added, since none existed for the new endpoint.

## 13. Admin UI

- Question bank list (`/admin/questions`): added "ICH ref." and
  "Case study" columns (previously only usable as filters), backed by a new
  `sourceSectionRef`/`questionGenerationType`/`caseStudyCount` projection on
  the list query; linked to a new "Readiness report" button.
- Blueprint page (`/admin/exams/[id]/blueprint`, pre-existing from Stage 7A):
  extended its coverage table with a "Shortfall" column and an overall
  shortfall note.
- New Question Bank Readiness page (`/admin/questions/readiness`,
  ADMIN-only): renders the count breakdowns and the blueprint coverage table
  with `READY`/`INSUFFICIENT`/`REQUIRES_REVIEW` badges - never a score.

## 14. Authorization

Question promotion reuses the existing `POST :id/promote` route on the
already-ADMIN/REVIEWER-gated `AiCandidatesController` (same roles as
`/convert-to-question`). The new readiness report is `ADMIN`-only, unlike
the question list itself (`CONTENT_AUTHOR`/`REVIEWER`/`ADMIN`), per the
gate's explicit requirement.

## 15. Database changes (all additive)

Four migrations across Gates 21-22, none destructive (manually reconfirmed

- only `CREATE TABLE`, `CREATE INDEX`, `ADD FOREIGN KEY`, `ADD COLUMN`,
  `ALTER TYPE ... ADD VALUE`):

- `ai_candidate_quality_reviews` table (Gate 21).
- `audit_action` enum value `AI_CANDIDATE_QUALITY_REVIEWED` (Gate 21).
- `question_versions.question_generation_type` column, reusing the existing
  `question_generation_type` enum (Gate 22).
- `audit_action` enum value `AI_CANDIDATE_PROMOTED_TO_QUESTION` (Gate 22).

## 16. Testing

- `QuestionPromotionService`: 13 unit tests (idempotency, every rejection
  path, fresh-duplicate-at-promotion-time, successful promotion, audit).
- `QuestionBankReadinessService`: 5 unit tests.
- `candidate-duplicate-check.util` extraction: `AiCandidateQualityReviewService`
  re-verified 9/9 passing after the refactor.
- New e2e file `gate22-question-promotion.e2e-spec.ts`: 13 tests covering
  authorization, the real promotion flow, blueprint volume limits (with a
  genuine ADMIN-token fixture, not an RBAC-masking negative test), and the
  readiness report's authorization and score-free content.
- One pre-existing Gate 16 e2e assertion (`case-study-generation-real-data.e2e-spec.ts`)
  had encoded a "no real case study ever reaches the question pipeline"
  invariant that was only ever true because no promotion path existed yet.
  Since Gate 22 built exactly that governed path on purpose, the assertion
  was updated to its real, permanent form: every such link must trace back
  to a `CASE_APPLICATION` question version, a real `AiQuestionCandidate`
  with `convertedQuestionId` set, and a matching `AI_CANDIDATE_CONVERTED`/
  `AI_CANDIDATE_PROMOTED_TO_QUESTION` audit event - i.e. governed and
  audited, never automatic.
- Final regression sweep, all green: root `pnpm typecheck` (4/4 packages),
  root `pnpm test` (656 API + 213 web), root `pnpm build` (both apps), root
  `pnpm lint` and `pnpm format:check`, full `pnpm --filter @gcp/api test:e2e`
  (25 suites / 383 tests, run serially), `prisma migrate status` (34
  migrations, up to date), and a repo-wide secret scan (no leaked Gemini key
  anywhere).

## 17. Real-data verification

`scripts/run-gate22-real-promotion.ts` promoted 5 real, previously-accepted
Gate 19-21 candidates (2 `DIRECT_GCP`, 3 `CASE_APPLICATION` spanning distinct
GCP domains) through the actual HTTP API using a genuinely signed JWT for
the real `gate16-reviewer@gcp-training.local` account (the same
ephemeral-server pattern used since Gate 21, since that account's one-time
password was never persisted). All 5/5 succeeded
(`GCP-Q-001180`-`GCP-Q-001184`, confirmed `DRAFT`). A before/after table-count
capture confirmed only the expected tables changed
(`AiQuestionCandidate.convertedQuestionId`/`Question`/`QuestionVersion` +5
each); every case-study/observation/exam/certificate table was unchanged.
The traceability fix (§7) was independently re-verified against this real
data via a direct Prisma inspection of `GCP-Q-001182`.

## 18. Limitations

- The readiness report's blueprint section only covers exams that already
  have a blueprint configured; exams without one are simply absent from the
  list (not flagged as `REQUIRES_REVIEW`).
- Coverage/shortfall figures are point-in-time snapshots - they are not
  reserved capacity and can change as soon as another question is
  published or archived.
- `MockAiProvider`'s fixed output content (unchanged from Gate 21) still
  means any two mock-generated `DIRECT_GCP` candidates collide as exact
  duplicates; tests needing multiple independently-promotable candidates
  continue to use the `createSyntheticReadyCandidate()` direct-Prisma-seed
  pattern established in Gate 21.

## 19. What Gate 22 does NOT implement

No exam execution/attempt/scoring, no certificate issuance, no automatic
exam assembly from a blueprint (blueprints still only describe the _kind_
of question required, never select actual questions), no embeddings/RAG/
vector DB, no mass question generation, no automatic publishing (every
promoted question is `DRAFT` only), and no AI-driven creation or
modification of taxonomy (domains, learning objectives, professional roles)
or external-AI-eligibility decisions.

## 20. Gate 23 prerequisites / recommendation

The question bank now has real, traceable, promotable `DRAFT` questions and
a blueprint architecture that can report shortfall - but nothing yet
_acts_ on a blueprint. The natural next gate is runtime exam assembly:
deterministic, blueprint-driven question selection into an actual exam
attempt, still without touching scoring/certificates, which remain
out of scope until the pool and blueprint coverage are demonstrably
sufficient for a real exam configuration.
