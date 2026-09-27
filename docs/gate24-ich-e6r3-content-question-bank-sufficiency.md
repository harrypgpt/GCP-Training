# ICH E6(R3) Training Content & Question-Bank Sufficiency (Gate 24)

## 1. Objective

Gate 24 answers one deterministic question: **does the actual, governed
question bank contain sufficient, balanced, traceable, examination-ready
content?** It is an audit/reporting gate, not a new engine - no new
exam-assembly logic, no new eligibility logic, no new AI generation. Every
computation composes existing services; nothing is re-derived.

## 2. Existing architecture (verified by direct inspection, not assumed)

Before writing anything, the actual Prisma schema and the relevant service
files were read directly (not just their docs). Findings that shaped the
design:

- `Source`/`SourceVersion` have **no unique constraint on title or
  `documentIdentifier`** - duplicate ICH E6(R3) registrations are
  structurally possible and must be actively checked, not assumed away.
- `LearningObjective` has **no direct FK to `SourceSection`** - the only
  ICH-section mapping that exists is indirect, derived from the questions
  that happen to reference both a learning objective and a
  `sourceSectionRefId` on the same row. A learning objective with zero such
  questions has no established mapping at all.
- `ExamBlueprintRule` (the existing, only "requirement" vocabulary in the
  system) has dimensions for domain/questionType/difficulty/
  learningObjective/professionalRole/level/caseStudyRequired/sourceRequired
  - but **no dimension for a specific ICH section**. There is currently no
    mechanism anywhere in the system that defines "N questions required for
    section 2.5" - only "N questions required for learning objective X."
- `QuestionDuplicatesService` already persists `QuestionDuplicateFlag` rows
  (`EXACT_STEM`/`DUPLICATE_OPTION_SET`) but exposed **no read/summary
  method** - it was write-only.
- `QuestionBankReadinessService` (Gate 22) already computed the base
  inventory (counts by status/type/difficulty/domain/LO/role) and blueprint
  coverage - Gate 24 **extends** this service's output rather than
  building a second dashboard, per its own explicit instruction.
- `QuestionVersion` carries a 1:1 back-relation to the `AiQuestionCandidate`
  it was converted from (`aiCandidate?`), which is how a real evidence
  category (`QuestionScenarioSourceType`) can be attributed to a question
  without inventing a new taxonomy.

## 3. ICH E6(R3) authority

`QuestionBankSufficiencyService.checkIchAuthority()` counts every
`SourceVersion` row with `documentIdentifier === 'E6(R3)'` and the number of
_distinct_ `Source` rows among them:

- 0 rows → `NOT_REGISTERED`
- exactly 1 distinct source → `SINGLE_AUTHORITATIVE_SOURCE`
- more than 1 distinct source → `DUPLICATE_REGISTRATION_DETECTED`

It never silently picks one registration to proceed with. Real result on
the live dev database: exactly one registration
(`a6cbd729-f09c-42a9-a262-239d79ecc0a4`) → `SINGLE_AUTHORITATIVE_SOURCE`.

## 4. Curriculum structure

`TrainingProgram → TrainingLevel → Module → Lesson → LearningObjective`
exists in the schema, but (confirmed by direct inspection, consistent with
Gate 14's own documentation) the Lesson/Module tree has zero authored rows
in this environment - real learning objectives are tied to a `GcpDomain`,
not a lesson. Gate 24's learning-objective inventory therefore reports
`domainName` (from the real taxonomy) rather than a lesson/module path, and
never fabricates a lesson-level mapping that does not exist.

## 5. Learning-objective and question-bank inventory

For every `LearningObjective`, the report computes (all derived from the
existing eligibility authority, §6, never a raw status filter):
`eligibleQuestionCount`, `draftOrOtherQuestionCount`, `candidateCount`,
`directGcpEligibleCount`, `caseApplicationEligibleCount`,
`mappedIchSectionCount` (distinct `sourceSectionRefId` values among its
eligible questions), and a `requirement` (§8).

## 6. Eligibility is never re-derived

Every "available"/"eligible" count in this report comes from
`ExamQuestionEligibilityService.listEligibleIds({})` - the same, sole
authority Gate 7A built and Gate 22's coverage service already trusted. A
`DRAFT` question, no matter how thoroughly reviewed and AI-governed, is
never counted as available. Proven directly by an e2e test that creates a
real `DRAFT` question tied to a learning objective and confirms its
`eligibleQuestionCount` is `0`.

## 7. Question-type separation (unchanged, reaffirmed)

`DIRECT_GCP`/`CASE_APPLICATION` remain exactly the two existing values of
the existing `QuestionGenerationType` enum. No new type was introduced.

## 8. Sufficiency methodology (required/available/shortfall)

For each learning objective, the report looks for an **active
`ExamBlueprintRule`** referencing it. If one exists, `required =
exactCount ?? minimumCount ?? 0` (the largest such value if multiple active
rules reference the same objective), `available` = its eligible count, and
`shortfall = max(0, required - available)`. If **no** rule references the
objective at all, the requirement is reported as the literal string
`NO_REQUIREMENT_DEFINED` - never an invented number, never treated as
insufficiency by default.

## 9. Why ICH-section-level sufficiency is always `NO_REQUIREMENT_DEFINED`

Per §2, `ExamBlueprintRule` has no section-level dimension today. There is
therefore no existing mechanism that could ever produce a real
per-section requirement, so every entry in `ichSectionCoverage` reports
`NO_REQUIREMENT_DEFINED` with only an informational eligible-question
count. This is a genuine, honest architectural gap surfaced by the audit -
closing it would mean extending `ExamBlueprintRule` with a new dimension,
which is explicitly out of scope for this gate (no schema changes without
proven necessity, and no invented numbers).

## 10. Blueprint readiness

Reused verbatim from Gate 22's `ExamBlueprintCoverageService` via the base
`QuestionBankReadinessService.getSummary().blueprints[]` - no second
blueprint/coverage engine was written.

## 11. Duplicate analysis

`QuestionDuplicatesService` gained exactly one new method,
`summarize()` (read-only: counts by `matchType`, resolved vs. unresolved),
reusing the exact same `QuestionDuplicateFlag` rows the existing
`detectAndFlag()` (triggered on `SUBMIT_FOR_REVIEW`, unchanged) already
writes. No embeddings, no semantic similarity, no second detection
mechanism.

## 12. Difficulty distribution

Reused verbatim from the base readiness summary's `byDifficulty` - the
existing `DifficultyLevel` enum (`EASY`/`MEDIUM`/`HARD`/`EXPERT`) is
untouched.

## 13. Quality-review dimension coverage

Aggregated directly from Gate 21's stored `AiCandidateQualityReview.qualityDimensions`
JSON, scoped to reviews whose candidate was actually converted into a real
question (`convertedQuestionId IS NOT NULL`) - an un-promoted review says
nothing about the current bank. No second review system, no re-derivation
of any dimension's value.

## 14. Normative-source validation

`computeNormativeGrounding()` classifies every _eligible_ (§6) question:
`DIRECT_GCP` with `sourceSectionRefId` set → valid; without it →
`directGcpMissingGrounding`. `CASE_APPLICATION` follows the identical rule.
Case-study evidence (`caseStudyLinks`) is never treated as a substitute for
the normative ICH reference, per the gate's own hard boundary (FDA/case
evidence provides scenario, never regulatory authority).

## 15. Case-study evidence coverage

Reuses the existing `QuestionScenarioSourceType` enum exactly (`NONE`,
`FDA_WARNING_LETTER`, `FDA_483`, `PRACTICAL_OBSERVATION`,
`EXPERT_OBSERVATION`, `OTHER_APPROVED_CASE_EVIDENCE`) via each eligible
question's `aiCandidate?.scenarioSourceType`. A hand-authored question with
no AI-candidate lineage at all is bucketed as `NOT_EVALUATED` - its
category is genuinely not determinable from existing metadata, not
assumed to be `NONE`.

## 16. Generation gap analysis

For every learning objective whose requirement (§8) has `shortfall > 0`,
one deterministic `GenerationGap` entry is emitted, with
`recommendedGenerationType` set to whichever of `DIRECT_GCP`/
`CASE_APPLICATION` has _fewer_ existing eligible questions for that
objective (`DIRECT_GCP` wins a tie, including zero-zero). This is a pure
function of already-computed counts - never an AI or human judgment call.

## 17. Controlled generation plan

The `generationGaps` array **is** the planning artifact - it is never
persisted, never triggers generation, and carries exactly the fields a
human would need to hand-author a real generation request
(`learningObjectiveId`, required/available/shortfall,
`recommendedGenerationType`). No new model was added to persist a "plan".

## 18. Real data only

No fixture, fake FDA observation, invented learning objective, or invented
question exists in the production dev database as a result of this gate.
The e2e suite uses its own isolated `SYNTHETIC_TEST_DATA`-style fixtures
(fresh, isolated `TrainingLevel`s per test, cleaned up in `afterAll`),
exactly as every prior gate has.

## 19. Admin readiness report (extended, not duplicated)

`GET /api/admin/questions/readiness` (the same Gate 22 endpoint, still
`ADMIN`-only) now also returns `ichAuthority`, `learningObjectiveCoverage`,
`ichSectionCoverage`, `normativeGrounding`, `caseStudyEvidenceCoverage`,
`duplicates`, `qualityDimensionCoverage`, `generationGaps`, and
`overallStatus`. The same admin page
(`apps/web/src/app/admin/questions/readiness/page.tsx`) was extended with
new cards/tables for each - no new route, no second dashboard.

## 20. Overall status (deterministic precedence, never a score)

`computeOverallStatus()` checks, in this fixed order, returning on the
first match:

1. `totalQuestions === 0` → `NOT_ASSESSED`
2. ICH authority not a single source → `REQUIRES_HUMAN_REVIEW`
3. Any normative-grounding gap exists → `REQUIRES_HUMAN_REVIEW`
4. Any unresolved duplicate flag exists → `REQUIRES_HUMAN_REVIEW`
5. Any generation gap exists → `INSUFFICIENT`
6. Any blueprint reports `INSUFFICIENT` → `INSUFFICIENT`
7. Any learning objective has `NO_REQUIREMENT_DEFINED` → `PARTIALLY_READY`
8. Otherwise → `READY`

No percentage, weighted average, or AI-derived score exists anywhere in
this computation or its output type.

## 21. Database changes

**None.** No migration was created. Every field in this report is computed
fresh from existing tables/columns on every call; `prisma migrate status`
remains at 34 migrations, unchanged, before and after this gate.

## 22. Security

The extended readiness endpoint remains `@Roles([UserRole.ADMIN])` -
confirmed by e2e tests that a `REVIEWER` and a `LEARNER` both still receive
`403`. No secret, credential, prompt, or answer key appears anywhere in the
response (the underlying eligible-question query never selects
`isCorrect`/`explanation`).

## 23. Audit

Zero new `AuditLog` rows are ever created by a readiness read - confirmed
by an e2e test that snapshots `auditLog.count()` (among other tables)
before and after two consecutive calls and asserts no change.

## 24. Tests

- **Unit** (`question-bank-sufficiency.service.spec.ts`, 20 tests):
  ICH authority (single/duplicate/unregistered), normative grounding
  (missing/valid for both types), case-study evidence bucketing including
  `NOT_EVALUATED`, learning-objective coverage
  (`NO_REQUIREMENT_DEFINED`/shortfall), the deterministic generation-gap
  recommendation (including the zero-zero tie), ICH section coverage
  (always `NO_REQUIREMENT_DEFINED`, and empty when unregistered), quality
  dimension aggregation scoped to converted candidates, every branch of the
  overall-status precedence, and a read-only guarantee.
- **Unit** (`question-duplicates.service.spec.ts`, new file, 2 tests): the
  new `summarize()` method.
- **E2E** (`gate24-question-bank-sufficiency.e2e-spec.ts`, 11 tests):
  unauthorized learner/reviewer rejection; zero database mutation across
  two consecutive real reads; `DIRECT_GCP`/`CASE_APPLICATION` missing vs.
  valid grounding on real published questions; a `DRAFT` question excluded
  from its objective's eligible count; `NO_REQUIREMENT_DEFINED` for an
  objective with no blueprint rule; a real shortfall/generation-gap
  computed from a real blueprint rule exceeding a real eligible pool; zero
  shortfall when the pool satisfies the rule; a real duplicate flag
  (triggered by the existing, unmodified detection mechanism) reflected in
  the report.
- **Regression**: root `format:check`, `lint`, `typecheck` (4/4 packages),
  `test` (678 API unit / 213 web unit, up from 656/213), `build` (both
  apps), full `pnpm --filter @gcp/api test:e2e` (27 suites / 396 tests, up
  from 25/383), `prisma migrate status` (34 migrations, unchanged), and a
  repo-wide secret scan - all green.

## 25. Real-data results

`scripts/run-gate24-real-data-verification.ts` called the real endpoint via
a real, signed JWT for the real `data-import-admin@gcp-training.local`
account (report in `data/imports/observations/reports/gate24-real-data-verification-report.json`):

```text
ICH E6(R3) authority: SINGLE_AUTHORITATIVE_SOURCE (1 registered version)
Total ICH sections: 11    Mapped: 0    Unmapped: 11
Total learning objectives: 83    Mapped: 0    Unmapped: 83
Total questions: 7    (all 7 currently DRAFT - none PUBLISHED)
  by generation type: DIRECT_GCP 2, CASE_APPLICATION 3, UNCLASSIFIED 2
Normative grounding: 0/0/0/0 (no eligible/PUBLISHED question exists yet)
Duplicates: 0 unresolved, 0 resolved
Blueprints configured: 0 (no exam exists yet in this environment)
Generation gaps: none (no blueprint rule exists to define a requirement yet)
Overall status: PARTIALLY_READY
```

**This is the honest, defensible answer Gate 24 set out to find**: the
real dev-database question bank is not currently examination-ready, but
**not because of any content-quality or architectural deficiency** - it is
because no question has ever been taken through the existing
`SUBMIT_FOR_REVIEW → APPROVE → PUBLISH` workflow yet (every real question
across Gates 15-23 has deliberately remained `DRAFT`, since no gate has
ever been authorized to auto-publish), and no exam blueprint with real
rules has been configured yet. `overallStatus` is `PARTIALLY_READY` rather
than `INSUFFICIENT` specifically because no requirement has been _defined
and violated_ - it is genuinely un-assessed territory, which is exactly the
distinction §8/§20 asked this gate to preserve. Also notable: 2 of the 7
real questions still show `questionGenerationType: null` (`UNCLASSIFIED`)

- these predate Gate 22's traceability fix and were never backfilled
  retroactively, a limitation already documented in Gate 22's own report.

## 26. Data-integrity baseline

Before/after counts across `Observation`, `ObservationVersion`,
`LearningObjective`, `Question`, `QuestionVersion`, `AiQuestionCandidate`,
`Exam`, `ExamAttempt`, `Certificate` were captured around the real-data
script's HTTP call and found byte-for-byte identical
(`observations: 1834`, `learningObjectives: 83`, `questions: 7`,
`aiQuestionCandidates: 28`, `exams: 0`, `examAttempts: 0`,
`certificates: 0`, unchanged both times) - confirming this gate performed
zero writes against the real database, exactly as intended.

## 27. Known limitations

- ICH-section-level sufficiency cannot be measured today (§9) - this is a
  real architectural gap, not a shortcut, and is left unresolved
  deliberately (out of scope: would require extending `ExamBlueprintRule`
  with a new dimension, a genuine future-gate decision).
- `caseStudyEvidenceCoverage` cannot classify a hand-authored (non-AI)
  question's evidence category at all (`NOT_EVALUATED`) - there is no
  existing field that would let it.
- The generation-gap recommendation is a simple, explainable heuristic
  (fewer-existing-questions wins), not a full curriculum-planning
  algorithm - deliberately, since anything more sophisticated risks
  becoming an AI/automated decision the gate explicitly prohibits.

## 28. Deviations from the literal prompt

None of substance. The prompt's suggested `AiQuestionCandidate`/
`QuestionVersion` field lists, `DifficultyLevel` values, and case-study
evidence category list were all confirmed to already exist exactly as
named, requiring no additions.

## 29. Explicit confirmation - prohibited items NOT implemented

No embeddings, vector database, RAG, semantic search, adaptive learning,
AI curriculum generation, AI learning-objective classification, AI
difficulty assignment, AI question approval, automatic publication, mass
Gemini generation, automatic rejection, new certificate architecture, new
scoring architecture, or new exam architecture. The exam/certificate
pipeline (Gate 23) was not touched.

## 30. Gate 25 recommendation

The real, honest finding from §25 is the actionable next step: the
question bank needs its existing `DRAFT` content actually published (a
human review-workflow action, already fully built, never exercised at
volume) and at least one real exam blueprint configured with real rules,
before any meaningful "sufficiency" number can move past
`PARTIALLY_READY`. That is an _operational_ task using entirely existing
tooling, not a new gate. If a new gate is warranted, it should be scoped
to closing the one genuine architectural gap this audit found (§9):
extending `ExamBlueprintRule` with an ICH-section-level requirement
dimension, so per-section sufficiency can finally be measured
deterministically rather than reported as `NO_REQUIREMENT_DEFINED` for
every one of the real ICH E6(R3)'s 11 sections.
