# Knowledge-to-Case-Study Generation Foundation (Gate 15)

Gate 15 builds the controlled foundation for turning curated GCP knowledge
(Gates 11-14) into structured educational case-study candidates, and the
mandatory human review workflow that separates a candidate from an approved
case study. It stops there: no case study is ever automatically generated,
approved, or turned into an examination question.

## 1. Architecture

```
Observation (Gate 11)
    -> Curated Knowledge (Gate 13/14: domain, role, risk, severity, root cause)
    -> Training Interpretation (Gate 13, unchanged, still optional)
    -> CaseStudySpecification (Gate 15 - the deterministic "recipe")
    -> AI Generation Run (Gate 15 - reuses the existing AI provider seam)
    -> CaseStudyVersion (Gate 15 - the candidate; the SAME row becomes the
       approved case study once its status reaches APPROVED/PUBLISHED)
    -> Human Review (Gate 15 - mandatory; AI can never approve itself)
    -> Approved / Published CaseStudyVersion
    -> [STOP - Gate 16+ may later consume this for question generation]
```

Every stage is a distinct, auditable database row - never collapsed. In
particular, `CaseStudyVersion.status` in `GENERATED`/`VALIDATION_FAILED`/
`READY_FOR_REVIEW`/`IN_REVIEW` **is** the AI candidate; the exact same row
reaching `APPROVED`/`PUBLISHED` **is** the approved case study. This is a
deliberate design choice (not a second table for "candidate" vs. "approved")
that exactly mirrors how `QuestionVersion`/`SourceVersion` already keep one
versioned row mutable-until-approved, then immutable.

## 2. CaseStudy lifecycle

The pre-existing, flat `CaseStudy` model (Gate 4) is left completely
untouched - its own fields, its own `reviewStatus`, its own
`/admin/case-studies` CRUD controller all keep working exactly as before.
Gate 15 adds, purely additively:

- `CaseStudy.currentPublishedVersionId` (nullable, unique FK to
  `CaseStudyVersion`) - mirrors `Observation.currentPublishedVersionId`/
  `Source.currentPublishedVersionId` exactly.
- `CaseStudy.versions` - the new, richer, versioned narrative history.

`CaseStudyVersionStatus` (new enum) governs the version's own lifecycle:

```
DRAFT -> READY_FOR_GENERATION -> GENERATION_IN_PROGRESS -> GENERATED
      -> VALIDATION_FAILED | READY_FOR_REVIEW -> IN_REVIEW
      -> APPROVED -> PUBLISHED -> ARCHIVED
```

`APPROVED`/`PUBLISHED`/`ARCHIVED` are immutable - a correction always
creates a new `CaseStudyVersion` row under the same `CaseStudy` identity,
exactly the Gate 10/11/Question versioning convention. AI generation code
can only ever produce `GENERATED`/`VALIDATION_FAILED` (see §9); only an
explicit `PATCH .../review` (human) reaches `APPROVED`, and only an
explicit `PATCH .../publish` (ADMIN) reaches `PUBLISHED`.

## 3. CaseStudySpecification

The deterministic "recipe" a curator authors and validates _before_ any AI
call. New model, additive, includes:

- `scenarioType` (one of the 15 closed values the prompt specifies -
  `INVESTIGATOR_DECISION`, `CRA_DECISION`, ... `INSPECTION_READINESS_SCENARIO`)
- `primaryObservationVersionId` (required FK) + optional
  `CaseStudySpecificationObservation` rows for supporting evidence
- `domainId`, `learningObjectiveId`, `professionalRoleIds` (join table),
  `riskDimensions`/`severity`/`rootCauseCategory` (reused Gate 11 enums),
  `trainingInterpretationId`
- `desiredDecisionPoint`, `expectedLearnerCompetency`,
  `allowedFactualBoundaries`, `prohibitedAssumptions`, `generationConstraints`
- its own small lifecycle (`CaseStudySpecificationStatus`:
  `DRAFT -> READY_FOR_GENERATION -> GENERATION_IN_PROGRESS -> GENERATED -> ARCHIVED`)
- `activeGenerationRunId` (unique) - the idempotency guard (§8).

A specification is only `POST`-creatable when its primary observation is
`READY_FOR_SPECIFICATION` or `HUMAN_REVIEW_REQUIRED` (never `NOT_READY`).
`POST .../validate` is a deterministic, non-AI completeness check; only a
valid specification transitions to `READY_FOR_GENERATION`.

## 4. Eligibility (never automatic)

`CaseStudyEligibilityService.assess(observationVersionId)` is a pure,
computed-on-read function (mirrors Gate 13's `computeReadinessSummary`
pattern) - **no new persisted readiness column** was added, since Gate 13's
existing `ObservationVersion.caseStudyReadiness` already exists and this
service derives a richer verdict from the same underlying curated fields
instead of duplicating a readiness system. States (`CaseStudyEligibilityState`,
a new shared TS/zod union, not a DB enum):

```
NOT_ASSESSED | NOT_READY | READY_FOR_SPECIFICATION
| READY_FOR_GENERATION | HUMAN_REVIEW_REQUIRED | APPROVED_FOR_CASE_STUDY
```

Deterministic rules checked, in order: not `ARCHIVED`; `curationStatus`
is `CURATED`/`APPROVED`; a domain is assigned; at least one professional
role is assigned; at least one risk/severity/root-cause basis exists;
evidence text is non-empty; a learning objective is linked (otherwise
`HUMAN_REVIEW_REQUIRED`, never a silent pass). No curated observation is
ever automatically case-study-ready - all 271 real curated observations
from Gate 14 are `READY_FOR_SPECIFICATION`, and the remaining 1,563
uncurated ones are correctly `NOT_READY`.

## 5. Grounding

`GroundingService.buildCaseStudyContext(specificationId, options)` (new
method on the _existing_ Gate 10/11 `GroundingService` - not a second
grounding framework) resolves, server-side, exactly what a specification
references: the primary observation's curated fields, supporting
observations, training interpretation, domain, roles, and learning
objective, plus a `knownIds` set the deterministic validator (§9) uses to
reject any fabricated reference. The browser never supplies evidence IDs
directly to a generation call - only a `specificationId`.

## 6. Training-interpretation boundary

`ObservationTrainingInterpretation` (Gate 13) is reused completely
unchanged. A specification may optionally reference one; the generated
narrative's `content.factualBoundaryStatements[]` tags any restatement of
it as `TRAINING_INTERPRETATION`, never as `SUPPORTED_FACT`. No training
interpretation was bulk-authored by this gate.

## 7. AI generation boundary

`CaseStudyGenerationService.generate()` reuses, unchanged: `AiProvider`
interface, `MockAiProvider`/`OpenAiProvider`, `AiProviderFactory`,
`AiPolicyService`, and the existing `AiGenerationRun` table (extended with
one additive column, `caseStudySpecificationId`, and one new
`AiOperation` value, `CASE_STUDY_GENERATION`). It is a **separate service**
from `AiGenerationService` (which orchestrates concept/LO/question
generation) because its specification-based eligibility/idempotency/
evidence-reference concerns are structurally different - but it is
explicitly not a second AI _framework_: the provider seam, retry policy,
and run-bookkeeping code shape are identical.

AI generation can only ever produce a `CaseStudyVersion` in status
`GENERATED` or `VALIDATION_FAILED` - never `APPROVED`/`PUBLISHED`.

## 8. Mock generation (deterministic)

`MockAiProvider.caseStudyOutput()` (new method, extends the existing mock)
returns structured output built _exclusively_ from
`request.context.primaryObservation`/`domain`/`learningObjective`/
`trainingInterpretation` - the exact fields the caller supplied, nothing
else. Tests (`case-study-generation.service.spec.ts`,
`case-study-output.validator.spec.ts`) prove the mock cannot reference an
observation/domain/role/ID outside what was actually passed in.

## 9. Deterministic validation

`validateCaseStudyOutput()` (new, mirrors `validateAiQuestionOutput`
exactly) checks, deterministically: title/scenario/decision-point/
learner-task non-empty; every `evidenceUsed` claim matches a label
actually present in the grounding context (rejecting fabricated
references); at least one `SUPPORTED_FACT`-tagged statement exists when
real evidence was supplied. Verdict is one of `VALIDATED` /
`VALIDATION_FAILED` / `HUMAN_REVIEW_REQUIRED` - never a claim of complete
factual correctness, and never silently repaired.

## 10. Factual boundary model

Every generated narrative's `content.factualBoundaryStatements[]` tags
each statement `SUPPORTED_FACT` / `TRAINING_INTERPRETATION` /
`SCENARIO_CONSTRUCTION` / `ASSUMPTION` (new `CaseStudyFactualBoundaryType`,
part of the structured JSON content, not a separate table - see §12 for
why). The validator specifically checks this distinction is present and
that at least one `SUPPORTED_FACT` exists whenever real evidence backs the
scenario.

## 11. Evidence traceability

`CaseStudyEvidenceReference` (new table) is the single, unified,
machine-readable citation model Gate 15 §15 asked for -
`evidenceType`/`evidenceRole` plus nullable FKs to every possible evidence
kind (`sourceId`/`sourceVersionId`/`sourceSectionId`/`observationId`/
`observationVersionId`/`trainingInterpretationId`/`learningObjectiveId`)
and a `claimText`. Rows are created **server-side from the resolved
grounding context**, never parsed out of AI-generated text - so a
fabricated ID can never reach this table. `CaseStudy -> CaseStudyVersion ->
CaseStudyEvidenceReference -> ObservationVersion -> SourceVersion ->
SourceSection` is fully queryable end to end.

## 12. Content storage decision

Rather than one scalar column per narrative field (~15 columns), the full
structured narrative (`context`, `setting`, `participantRoles`,
`situation`, `observedIssue`, `decisionPoint`,
`evidencePresentedToLearner`, `learnerTask`, `expectedCompetency`,
`educationalRationale`, `assumptions`, `generatedLimitations`,
`qualityWarnings`, `factualBoundaryStatements[]`) is stored as one
`content: Json` column on `CaseStudyVersion`, with `title`/`scenario`
promoted to real, indexed scalar columns for list/display - exactly
mirroring the existing `CaseStudy.title`/`scenario` pattern and Gate 12/13's
own precedent (`rawSourceFields`, `classificationBasis`) for flexible
structured content. The deterministic validator inspects the parsed JSON
structure, not free text.

## 13. Human review workflow

`CaseStudyVersionsService` (new) enforces the mandatory review gate:
`PATCH .../review-start` (REVIEWER/ADMIN, `READY_FOR_REVIEW -> IN_REVIEW`),
`PATCH .../review` with `{decision: APPROVE|REJECT|REQUEST_REVISION}`:
`APPROVE -> APPROVED`, `REJECT -> ARCHIVED` (never deleted - a rejected
candidate remains in history), `REQUEST_REVISION -> DRAFT` (editable
again). `PATCH .../publish` (ADMIN-only) requires `APPROVED` and sets
`CaseStudy.currentPublishedVersionId` - the previously-current version is
never mutated, only superseded. Reviewer identity and timestamp are
recorded on every decision.

## 14. External AI governance

`buildCaseStudyContext` enforces the exact same boundary Gates 10-13
already established: an external provider request is rejected
(`EXTERNAL_CONTENT_BLOCKED`) unless the primary observation's _published
version_ is both `SAFE_FOR_EXTERNAL_AI` and `APPROVED_FOR_EXTERNAL_AI`
(de-identified). Curation completeness never implies external-AI
eligibility - they are independent governance decisions, exactly as in
Gate 13.

## 15. API endpoints

```
POST   /admin/case-study-specifications
GET    /admin/case-study-specifications
GET    /admin/case-study-specifications/eligibility/:observationVersionId
GET    /admin/case-study-specifications/:id
PATCH  /admin/case-study-specifications/:id
POST   /admin/case-study-specifications/:id/validate
POST   /admin/case-study-specifications/:id/generate
GET    /admin/case-study-generations/:runId
GET    /admin/case-studies/:caseStudyId/versions
GET    /admin/case-studies/:caseStudyId/versions/:versionId
POST   /admin/case-studies/:caseStudyId/versions            (human-authored)
PATCH  /admin/case-studies/:caseStudyId/versions/:versionId/review-start
PATCH  /admin/case-studies/:caseStudyId/versions/:versionId/review
PATCH  /admin/case-studies/:caseStudyId/versions/:versionId/publish
```

The pre-existing `/admin/case-studies` (list/get/create/update/status/
delete) flat CRUD controller is untouched.

## 16. Security

Every route above is `@Roles`-gated (verified by direct inspection - no
route lacks a decorator): `CONTENT_AUTHOR`/`REVIEWER`/`ADMIN` for reads,
`CONTENT_AUTHOR`/`ADMIN` for specification writes, `REVIEWER`/`ADMIN` for
review decisions, `ADMIN`-only for publish and for the priority-style
`GET .../eligibility/:id` read stays at read-role level. `LEARNER` and
unauthenticated callers are rejected (401/403, e2e-verified). Version
lookups are IDOR-safe: a version requested under the wrong `caseStudyId`
returns the same 404 as a nonexistent one (e2e-verified). No API key is
ever persisted or exposed to the frontend - all generation runs
server-side only.

## Test strategy

Unit: `case-study-eligibility.service.spec.ts` (8), `case-study-output.
validator.spec.ts` (8, pure function), `case-study-specifications.service.
spec.ts` (6), `case-study-versions.service.spec.ts` (9), `case-study-
generation.service.spec.ts` (8, using the real `MockAiProvider` for
genuine determinism proof), plus 3 new `grounding.service.spec.ts` cases
for `buildCaseStudyContext`'s external-AI boundary. E2E:
`case-study-generation.e2e-spec.ts` (17 tests) against the real HTTP stack
and database - specification CRUD, invalid-observation/invalid-LO
rejection, ineligible-observation rejection, validate, generate, IDOR,
unauthorized-learner, in-progress-generation rejection, human review
(approve/reject/request-revision), publish, publish-twice rejection,
human-authored version creation. Frontend: 10 tests across the 3 new pages
(access control, source-evidence display, explicit-confirmation-before-
generation, validation display, review controls gated by role, publish
gated by role).

## Known limitations

- No plain `/admin/case-studies` index/list page was built for the new
  versioned model - a reviewer reaches a case study via the link a
  generation request returns, or via the pre-existing flat
  `/admin/case-studies` API. This mirrors the platform's own existing
  precedent (Gate 4's training-hierarchy CRUD and Gate 14's taxonomy
  governance also ship API-first without a dedicated index page in every
  case).
- Bulk generation was deliberately not implemented - the prompt itself
  states "prefer single-generation workflow for Gate 15," and no
  architectural need for it was demonstrated.
- The idempotency/race-condition e2e test exercises the atomic
  `updateMany`-based claim directly (by simulating an in-progress
  generation) rather than via genuinely concurrent HTTP requests, because
  the deterministic mock provider resolves in ~1ms - too fast for a real
  two-request race to reliably land inside the in-flight window in a test
  environment. The atomic claim itself is unit- and code-reviewed.
- `AiGenerationRun` was not given a `domainId` column (it never had one in
  any prior gate) - domain provenance for a case-study run is available
  via `caseStudySpecificationId -> CaseStudySpecification.domainId` instead.
- No question, exam, blueprint, or certificate code path was touched.

## Future Gate 16 interface

A future gate consuming this foundation should read only `CaseStudyVersion`
rows with `status = PUBLISHED` (or `APPROVED`, if pre-publication use is
ever sanctioned), and should resolve their `CaseStudyEvidenceReference`
rows for full evidence traceability before generating any question. No
`Question`/`QuestionVersion` row should ever be created directly from a
`CaseStudyVersion` without an explicit, separate human-reviewed step -
exactly the same principle this gate already applies to case-study
generation itself.
