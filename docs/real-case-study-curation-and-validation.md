# Real Case-Study Curation, Generation & Human Validation (Gate 16)

Gate 16 proves the Gate 15 architecture against **real, curated observations**
rather than fabricated fixtures. It adds nothing to the pipeline's shape -
`CaseStudyEligibilityService`, `AiProviderFactory`/`AiPolicyService`/
`GroundingService`/`MockAiProvider`, and the `CaseStudyVersion` review
workflow are all reused unchanged - and adds exactly two new pieces: a
deterministic real-data tranche-selection log (`CaseStudyTranche`/
`CaseStudyTrancheItem`) and a training-interpretation-approval gate that
closes a real gap the Gate 15 code left open.

## 1. Real-data tranche selection

`CaseStudyTrancheService.selectTranche()` (never random) evaluates every
`ObservationVersion` with `curationStatus` in `CURATED`/`APPROVED` against
`CaseStudyEligibilityService.assess()` - the same, single source of truth
used everywhere else - and records a `CaseStudyTrancheItem` for **every**
candidate considered, included or not. Priority order:

- **PRIORITY_1**: FDA Warning Letter observations, or observations carrying
  the `COMPUTERIZED_SYSTEM` risk dimension, or observations curated into the
  `DATA_INTEGRITY` domain.
- **PRIORITY_2**: every other eligible curated observation, drawn
  round-robin across domains (sorted alphabetically by domain code) so
  breadth is favored over depth.
- Ordering within each tier is `id` ascending - deterministic, reproducible.

A `CaseStudyTranche` is a **selection audit trail**, never a competing
readiness authority: `eligibilityState` on each item is a snapshot of what
`CaseStudyEligibilityService` returned at selection time, nothing more.

## 2. Eligibility (reused, not reimplemented)

No new eligibility logic was written. `CaseStudyEligibilityService.assess()`
(Gate 15) remains the only place that decides `NOT_READY` /
`HUMAN_REVIEW_REQUIRED` / `READY_FOR_SPECIFICATION`. An observation that is
`eligibleForSpecification === false` and not `HUMAN_REVIEW_REQUIRED` is
excluded from the tranche with its exact `reasons[]` recorded verbatim as
`exclusionReason` - never silently dropped, never forced in.

## 3. Deterministic training interpretation authoring

`generateTrainingInterpretation()` (`real-data/training-interpretation-
content.ts`) is a **pure, human-authored template function**, not an AI
call: it composes seven labeled sections (`SOURCE FACT`, `EDUCATIONAL
INTERPRETATION`, `LEARNER TAKEAWAY`, `EXPECTED BEHAVIOR`, `RISK
IMPLICATION`, `RECOMMENDED CONTROL/ACTION`, `LIMITATIONS / BOUNDARIES`) from
already-curated fields, quoting `originalText` verbatim and substituting
`NOT ESTABLISHED BY SOURCE` for any gap (missing domain, missing root
cause). It branches explicitly on evidence provenance: an
`FDA_WARNING_LETTER_OBSERVATION` gets FDA-bounded language ("the FDA
observation identified... not by itself a statement that this exact
corrective action is a universal regulatory requirement"); a
`PRACTICAL_EXPERIENCE` observation is labeled as such and never presented as
authoritative. It never invents a year, a CFR/ICH citation, or a subject
count (enforced by unit tests).

## 4. Training interpretation workflow

Interpretations reuse the existing Gate 13 `ObservationTrainingInterpretation`
model and the platform's one generic content-workflow FSM
(`DRAFT -> REVIEW -> APPROVED -> PUBLISHED -> ARCHIVED`, `ObservationTraining
InterpretationService.transition()`), not a bespoke Gate 16 state machine.
`SUBMIT_FOR_REVIEW` requires `CONTENT_AUTHOR`/`ADMIN`; `APPROVE` requires
`REVIEWER`/`ADMIN` - the author cannot approve their own interpretation.
`APPROVED` is a terminal state reachable only via `PUBLISH`/`ARCHIVE`
afterward, never back to `DRAFT`/`REVIEW`.

## 5. Case-study specification workflow

`CaseStudySpecificationsService.create()`/`.validate()` are unchanged from
Gate 15 except for the fix in §10 below. A specification records the
primary observation, domain, professional roles, learning objective,
training interpretation, scenario type, desired decision point, expected
competency, and factual-boundary/prohibited-assumption text - all
server-validated against real rows, never trusted from the request body.
Only `validate()` succeeding transitions `DRAFT -> READY_FOR_GENERATION`;
only `READY_FOR_GENERATION`/`GENERATED` may call `generate()`.

## 6. AI generation (Mock only)

`CaseStudyGenerationService.generate()` is reused exactly as Gate 15 built
it. Every real-tranche candidate in this gate was generated through the
deterministic `MockAiProvider` (`AI_PROVIDER=mock`); the full workflow -
selection, interpretation, specification, generation, validation, review,
publication - was proven without a single OpenAI/external-provider call.

## 7. Evidence grounding

`GroundingService.buildCaseStudyContext()` (Gate 15, unchanged) resolves the
specification's primary/supporting observations, domain, roles, learning
objective, and training interpretation server-side and hands the provider
only that resolved context - the browser never supplies raw evidence text.
`knownLabels` derived from this context are exactly what the deterministic
validator (§9) checks every claimed `evidenceUsed` entry against.

## 8. Factual-boundary discipline

Every AI candidate's `factualBoundaryStatements[]` classifies each claim as
`SUPPORTED_FACT`, `TRAINING_INTERPRETATION`, `SCENARIO_CONSTRUCTION`, or
`ASSUMPTION`. The mock provider always cites the real primary observation as
`SUPPORTED_FACT` and any constructed narrative detail as
`SCENARIO_CONSTRUCTION` - it never blends the two.

## 9. Human review (mandatory, AI cannot self-approve)

`CaseStudyVersionsService.review()` is the single gate to `APPROVED`; the
decision (`APPROVE`/`REJECT`/`REQUEST_REVISION`) is always recorded with
`reviewerId`+`reviewedAt`, and `REJECT` archives the version rather than
deleting it. `publish()` is a **separate**, `ADMIN`-only action that only
succeeds from `APPROVED` - a version reaching `APPROVED` never automatically
becomes `PUBLISHED` in the same call; the real tranche run produced 48
`APPROVED` versions and published only 3 of them, proving the two steps stay
independent in practice, not merely by code inspection.

## 10. Training-interpretation-approval gate (the one real fix Gate 16 made)

Gate 15's `CaseStudySpecificationsService.assertTrainingInterpretationExists`
only checked that a linked `trainingInterpretationId` **existed** - a
`DRAFT` or `REVIEW` interpretation could ground a specification exactly as
if it had been reviewer-approved. Gate 16 closes this: the check now
requires `reviewStatus === 'APPROVED'` both at specification-creation time
and again at `validate()` time (defense in depth, in case the interpretation
is archived after the specification was created), rejecting with the new
`TRAINING_INTERPRETATION_NOT_APPROVED` error code (409) otherwise. Covered
by unit tests (`case-study-specifications.service.spec.ts`) and an e2e test
that walks DRAFT -> REVIEW -> APPROVED against the real HTTP API, confirming
the specification is rejected at every stage before APPROVED.

## 11. FDA vs. practical evidence separation

`ObservationEvidenceClass`/`observationType` are never collapsed: an FDA
Warning Letter observation is described as "FDA-documented evidence" with
explicit non-universality language; a practical/audit observation is
labeled `PRACTICAL_EXPERIENCE evidence... not an authoritative regulatory
source`. Both the deterministic interpretation template and the mock
provider's grounding preserve this distinction end-to-end into the
candidate's evidence references.

## 12. External AI policy

`GroundingService.buildCaseStudyContext()` blocks external-provider requests
before any provider call when the primary observation is not simultaneously
`externalAiEligibility = SAFE_FOR_EXTERNAL_AI` on both the version and the
observation, and `deIdentificationStatus = APPROVED_FOR_EXTERNAL_AI` -
`EXTERNAL_CONTENT_BLOCKED` (403), verified in
`grounding.service.spec.ts` and, at the full-generation-pipeline level, in
`case-study-generation.service.spec.ts` (`external AI eligibility` describe
block): no `AiGenerationRun` row, no `CaseStudyVersion` row, and no provider
`.complete()` call occur when the block fires. This is a `GroundingService`
property, independent of which provider is configured - the mock provider
being used for tests does not stand in for or weaken this check.

## 13. Quality review / unsupported-claim detection

`validateCaseStudyOutput()` (Gate 15, unchanged) flags any `evidenceUsed`
entry that cannot be matched to `knownLabels`: fully-unsupported evidence
fails validation outright (`VALIDATION_FAILED`); a partially-unsupported
claim downgrades the candidate to `HUMAN_REVIEW_REQUIRED` rather than
`VALIDATED` - never silently accepted. `MockAiProvider` gained a
`simulate: 'unsupported_claim'` test hook (deterministic, clearly labeled as
a test fixture, never a fabricated regulatory citation) that appends a
fabricated evidence reference to an otherwise well-formed candidate,
exercised end-to-end through `CaseStudyGenerationService.generate()` in
`case-study-generation.service.spec.ts`.

## 14. Traceability

Every approved real case study's chain - `Observation` ->
`ObservationVersion` (with its curated domain/role/risk/severity/root
cause) -> `ObservationTrainingInterpretation` -> `CaseStudySpecification` ->
`AiGenerationRun` -> `CaseStudyVersion` -> `CaseStudyEvidenceReference` ->
reviewer identity/timestamp -> `PUBLISHED` - is reconstructable by ID alone.
`test/case-study-generation-real-data.e2e-spec.ts` proves this for one real
FDA Warning Letter observation (`OBS-FDA-WL-623671`) end-to-end against the
live database, asserting every foreign key matches rather than merely
existing.

## 15. Audit

Two new `AuditAction` values were added: `CASE_STUDY_TRANCHE_SELECTED`
(recorded once per `selectTranche()` call, with candidate/included/excluded
counts) and `CASE_STUDY_SPECIFICATION_VALIDATED` (reserved for future use;
`validate()` currently records under the existing
`CASE_STUDY_SPECIFICATION_UPDATED` action with a `validated: true` metadata
flag, matching Gate 15's convention of not duplicating an existing
equivalent action). No existing Gate 1-15 audit action was modified.

## 16. Security

Tranche endpoints (`/api/admin/case-study-tranches`) require
`CONTENT_AUTHOR`/`REVIEWER`/`ADMIN` for reads and `CONTENT_AUTHOR`/`ADMIN`
for selection - a learner request returns 401/403 (verified in e2e). All
other authorization/IDOR properties (wrong-case-study 404, reviewer-only
approval, admin-only publish) are Gate 15's existing, unchanged, and
re-verified in this gate's full regression run.

## 17. Metrics and limitations (the actual real-tranche run)

Executed once via `pnpm --filter @gcp/api gate16:real-tranche`
(`apps/api/scripts/run-gate16-real-tranche.ts`), against the real database
(155 curated observations at the time of the run):

| Stage                                       | Count                                         |
| ------------------------------------------- | --------------------------------------------- |
| Curated candidates evaluated                | 155                                           |
| Selected into the tranche                   | 50 (36 PRIORITY_1, 14 PRIORITY_2, 20 domains) |
| Excluded (with recorded reason)             | 105                                           |
| Training interpretations created & approved | 50                                            |
| Specifications created & validated          | 50                                            |
| Mock generations requested / succeeded      | 50 / 50                                       |
| Sent to human review                        | 50                                            |
| Approved                                    | 48                                            |
| Sent to REQUEST_REVISION                    | 2                                             |
| Published                                   | 3                                             |
| External AI calls                           | 0                                             |
| Validation failures                         | 0                                             |

These are the actual numbers from one real run, not illustrative examples.
**Limitation**: the real observation bank currently yields far more
PRIORITY_2 candidates than PRIORITY_1; a future real-data run with a larger
FDA/computerized-system tranche would shift this mix. **Limitation**: only
3 of 48 approved candidates were published in this run - publication is a
deliberate, individually-confirmed ADMIN action, not a bulk operation, by
design.

## 18. Interface for Gate 17

Gate 16 deliberately stops at a `PUBLISHED CaseStudyVersion`. It creates no
`Question`/`QuestionVersion`/`QuestionCandidate`/`ExamBlueprintRule` rows and
no link from any `CaseStudyVersion` into the exam runtime - confirmed by an
e2e assertion that zero `QuestionCaseStudyLink` rows reference any Gate 16
case study. A future Gate 17 (case-study -> question generation) can read
`CaseStudyVersion.status = 'PUBLISHED'` rows and their evidence references
exactly as any other approved content, without any Gate 16 schema change.

## Real vs. synthetic data

The real-tranche run above touches only real, previously-imported
observations (never `SYNTHETIC_TEST_DATA`). All Gate 16 automated tests use
their own `SYNTHETIC_TEST_DATA`-labeled fixtures with unique per-run
suffixes, created and deterministically cleaned up in `afterAll` - the same
convention every prior gate's e2e suite already follows. The real-tranche
report is a separate, explicit script run, not something any test suite
triggers.
