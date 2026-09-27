# Exam Pipeline Governance Audit & Integration Hardening (Gate 23)

## 1. Objective

Gate 23 was scoped as a deterministic blueprint-driven exam-assembly build.
Before writing anything, the existing architecture was inspected (per this
project's standing rule to never invent architecture that already exists),
and that inspection found the entire proposed scope - blueprint-driven
question selection, attempt/answer-capture, server-side scoring, and
certificate issuance - already built, live, and passing, under an earlier
internal staging scheme ("Gate 7A/7B/7D/7E/8"). Gate 23 therefore became an
**audit and integration-hardening gate**: verify the existing pipeline is
sound and consistent with everything Gates 20-22 added, and close the one
real gap the audit found, rather than duplicate working code.

## 2. What already existed (verified, not rebuilt)

- **Blueprint → pool resolution & selection**: `ExamQuestionSelectionService`
  and `exam-selection.util.ts` resolve a blueprint's active rules against
  the eligible pool (via `ExamQuestionEligibilityService` - the same
  service Gate 22's coverage report uses), satisfy every mandatory rule,
  and fail with explicit `INSUFFICIENT_ELIGIBLE_POOL`/
  `CONSTRAINTS_NOT_SATISFIABLE` diagnostics rather than relaxing anything.
- **Attempt foundation & answer capture**: `LearnerExamAttemptService`
  snapshots the exact `QuestionVersion`/`QuestionOption` IDs selected for an
  attempt into `ExamAttemptQuestion`/`ExamAttemptQuestionOption`, enforces a
  single in-progress attempt per learner, and never returns `isCorrect` in
  any learner-facing payload.
- **Scoring & pass/fail**: `LearnerExamScoringService` finalizes a submitted
  attempt server-side exactly once (idempotent on repeat calls), with a
  documented `PENDING`-not-a-false-score fallback if a historical
  data-integrity problem is found mid-evaluation.
- **Certificates**: `CertificatesModule` (admin/learner/public controllers)
  issues exactly one certificate per qualifying `PASSED` attempt, with
  denormalized `*Snapshot` fields so a later program/level rename can never
  bleed into an already-issued certificate, and revocation as a one-way,
  one-time transition.

All three modules (`ExamsModule`, `LearnerExamsModule`, `CertificatesModule`)
are wired live into `AppModule` (via `AdminContentModule`/
`LearnerContentModule` and directly, respectively), and their five e2e
files (`exams`, `learner-exams`, `learner-exam-submission`,
`learner-exam-result`, `certificates`) were already part of every full
`pnpm --filter @gcp/api test:e2e` run during the Gate 22 regression sweep -
they were simply never singled out by name.

## 3. Audit findings against Gates 20-22's governance additions

Each of the following was specifically checked, since it is exactly the
kind of seam where two separately-built halves of the system could silently
diverge:

- **Promotion-never-auto-publishes boundary holds all the way to the exam
  engine.** `ExamQuestionEligibilityService.buildWhere()` filters strictly
  on `reviewStatus: 'PUBLISHED'` + `currentForQuestion: { isNot: null }` +
  `isActive: true`, and never queries `AiQuestionCandidate` at all. A Gate
  22-promoted `DRAFT` question - no matter how thoroughly reviewed and
  promoted - is invisible to this filter until an admin independently takes
  it through the existing `SUBMIT_FOR_REVIEW → APPROVE → PUBLISH` content
  workflow. Proven by a new e2e test (§5).
- **Coverage/readiness reporting and live selection share one eligibility
  authority.** Gate 22's `ExamBlueprintCoverageService` and the live
  `ExamQuestionSelectionService` both build their candidate pool through
  the same `ExamQuestionEligibilityService.listEligible`/`countEligible` -
  there is no second, divergent eligibility implementation for either
  "diagnostic" or "live" purposes.
- **Attempt snapshots are immutable against later question-bank changes.**
  `ExamAttemptQuestion.questionVersionId`/`ExamAttemptQuestionOption.questionOptionId`
  are `onDelete: Restrict` foreign keys to specific, versioned rows -
  `QuestionVersion` rows are never edited in place (Stage 6's versioning
  workflow supersedes rather than mutates), so a historical attempt cannot
  be silently changed by later question-bank activity, and the FK
  constraint would block any attempt to delete a version still referenced
  by a real attempt.
- **Ownership/IDOR safety.** Every attempt/result/certificate lookup filters
  by `{ id, userId }` (or attempt ownership for certificates) directly in
  the Prisma `where` clause, not as a post-fetch check - confirmed by
  reading every query site in `LearnerExamAttemptService`.
- **Answer-key protection is structural, not conventional.** The Prisma
  `select` for `getAttemptQuestions` explicitly omits `isCorrect`/
  `explanation`/`rationale` - the field is absent from the query result
  itself, not merely unmapped in the response DTO.
- **DIRECT_GCP/CASE_APPLICATION provenance is never lost by the exam
  engine.** `questionGenerationType` and `sourceSectionRefId` live on
  `QuestionVersion` itself; nothing in the attempt/scoring/certificate path
  copies, drops, or overwrites them - confirmed both by code inspection and
  by a direct-database assertion at the end of the new integration test
  (§5), which reads them back from a completed, certificate-issued attempt.

No code defect was found in any of the above - every property already held.

## 4. The one real gap: no test proved the full chain

Every existing test proved its own slice in isolation. The exam/certificate
e2e suite always seeded its own question pool directly via
`createPublishedQuestion()` (a raw admin-create-and-publish helper),
completely bypassing the AI-generation → human-review → promotion path.
Nothing had ever exercised a question that was actually born from Gates
15-22's governed pipeline all the way through to a certificate. This is the
one substantive hardening this gate adds.

## 5. New coverage: `gate23-exam-pipeline-integration.e2e-spec.ts`

Two tests, both against real HTTP endpoints (no direct service calls) and a
real, live NestJS app instance:

1. **The full chain, positive case.** A synthetic-but-realistic DIRECT_GCP
   candidate (grounded in the real, registered ICH E6(R3) source from Gate 18) goes through: quality review `ACCEPT` → `promote()` (asserted still
   `DRAFT`) → `SUBMIT_FOR_REVIEW`/`APPROVE`/`PUBLISH` → confirmed counted by
   `GET /admin/questions/readiness` (`byReviewStatus.PUBLISHED`,
   `byQuestionGenerationType.DIRECT_GCP`) → confirmed by
   `GET /admin/exams/:id/blueprint/coverage` as the exact, sufficient
   eligible pool (`eligiblePoolSize: 1`, `questionCountShortfall: 0`,
   `feasible: true`) → exam `ACTIVATE` → learner `start` → the assembled
   attempt's one question is asserted to be exactly this `QuestionVersion`
   (by ID) → answer-key protection re-confirmed on this real payload →
   correct answer submitted → `GET .../result` asserts `PASSED`/`100%` →
   `POST /learner/certificates/issue` asserts `ACTIVE` → a final direct
   Prisma read of `ExamAttemptQuestion.questionVersion` confirms
   `questionGenerationType`/`sourceSectionRefId` are still intact after the
   entire chain has completed.
2. **The boundary, negative case.** The same steps up through `promote()`,
   but the question is deliberately left `DRAFT` (never published). The
   coverage report correctly reports `eligiblePoolSize: 0`/`feasible: false`
   for an isolated level containing only this one, unpublished question,
   and activating the exam is refused outright (`409`, Gate 22's own
   `sufficient_overall_pool` blueprint-validation check) - assembly never
   gets the chance to silently relax the requirement, because activation
   itself already refuses.

## 6. Testing / regression

- New file: 2 e2e tests, both passing.
- Full e2e suite: 26 suites / 385 tests, all passing (up from 25/383 before
  this gate).
- Root `pnpm lint`, `pnpm typecheck`, `pnpm test` (656 API unit + 213 web
  unit), `pnpm build` (both apps): all green.
- No production code was changed in this gate - only a new, additive test
  file. No new migration, no schema change, no new endpoint, no new UI.

## 7. Limitations

- The integration test uses a synthetic (not real-Gemini-generated)
  candidate, consistent with Gate 22's own "real-data verification is
  capped and reuses existing candidates" pattern - the point of this test
  is proving the pipeline's plumbing connects, not re-proving AI-generation
  quality (already covered by Gates 15-21's real-data verification).
- Only the `DIRECT_GCP` generation type was exercised end-to-end through a
  certificate in this new test; `CASE_APPLICATION` provenance survival
  through the exam engine was confirmed by code inspection (§3) rather than
  a second full-chain test, since the fixture cost (a full case-study
  chain: Source → SourceVersion → SourceSection → Observation →
  ObservationVersion → TrainingInterpretation → CaseStudySpecification →
  CaseStudyVersion) was judged disproportionate to the marginal proof value
  once the underlying mechanism (a single column read straight through,
  untouched by the exam engine) was already inspected and understood.
- The pre-existing selection algorithm (`secureShuffle`, Fisher-Yates with
  Node's cryptographically-strong `randomInt`) is deliberately
  non-reproducible from a fixed seed - a real, intentional exam-security
  design choice (a reproducible seed would let one learner predict or share
  another's exact question set). This was surfaced explicitly to the user
  before this gate began, and the audit-and-harden path was chosen over
  changing it.

## 8. What Gate 23 does NOT change

No new exam-assembly engine, no scoring changes, no certificate changes, no
new admin UI, no schema/migration, no embeddings/RAG, no mass AI generation,
no new AI provider call. Every property this gate verifies was already
true; this gate only adds the missing proof that it is true across the
full, real chain.

## 9. Recommendation

The examination pipeline (assembly through certificate) is confirmed sound
and correctly integrated with Gates 20-22's governance additions. There is
no remaining "Gate 24/25/26" of new construction to do for this slice - it
already exists. Future work in this area should be genuinely new capability
(e.g. analytics on aggregate exam performance, or adaptive
difficulty) only if and when actually justified by a real product need,
per the user's own stated preference not to add speculative complexity.
