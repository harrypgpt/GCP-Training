# FDA 483 & Real-World Observation Knowledge Foundation (Gate 11)

Gate 11 gives the platform a controlled, versioned, auditable structure for
real-world GCP observation evidence - FDA Form 483 observations, inspection
and audit findings, proprietary observation banks, and clinical-trial
operational observations - that later gates (case-study authoring, question
generation) can draw on with exact provenance and classification. This is a
**knowledge-management system for education, reference, and traceability**.
Observation evidence is never presented as authoritative regulatory text, and
this platform does not determine or certify regulatory compliance.

## What Gate 11 does NOT implement

Per its own scope boundary, this gate deliberately contains none of: a mass
import of any real observation bank, AI-generated questions, the advanced
question-generation engine, embeddings, vector/semantic search, semantic
duplicate detection, adaptive learning, predictive analytics, an autonomous
regulatory-interpretation engine, or any change to examination/certificate/
scoring logic. All test fixtures used in this gate's own test suites are
synthetic and explicitly marked `SYNTHETIC_TEST_DATA` - never real FDA 483
text presented as genuine.

## Observation architecture: identity vs. version

The Gate 4 `Observation` model already existed (`observationCode`,
`description`, single nullable `caseStudyId`/`domainId`/`sourceId`,
`riskCategory`, `reviewStatus: ContentStatus`, mutable in place via
`update()`) and is used today by exam/question-eligibility and case-study
linkage. Rule 1 required proving this model could not support Gate 11's
requirements before creating anything new: it has no FDA-483 fields, no
de-identification concept, no CAPA/root-cause/expected-action structure, only
a single nullable role-adjacent relationship (Gate 11 requires multi-role,
multi-case-study linkage), and no versioning/immutability - extending it
in place would either bloat the identity row with dozens of new columns and
lose all historical/immutability guarantees, or require the same
identity/version split Gate 10 already proved out for `Source`. Gate 11
implements that same proven split rather than inventing a new pattern:

```
Observation (identity - unchanged: observationCode, description, caseStudyId,
             domainId, riskCategory, sourceId, reviewStatus, version,
             isActive, externalAiEligibility, every existing relation)
  -> ObservationVersion (one immutable-once-published revision; evidence text,
     full provenance/FDA-483/classification/root-cause/CAPA/de-identification/
     licensing/AI-eligibility metadata)
    -> ObservationVersionProfessionalRole (many-to-many role linkage)
    -> ObservationVersionCaseStudy (many-to-many case-study linkage)
ObservationImportBatch -> ObservationImportRow (controlled, preview-first import)
```

`Observation.currentPublishedVersionId` (new, nullable, unique FK to
`ObservationVersion`) mirrors `Question.currentPublishedVersionId` and
`Source.currentPublishedVersionId` exactly: it moves forward on each publish;
the version it used to point to is never deleted or mutated, it simply stops
being "current" while remaining fully queryable historically. Every existing
field, relation, and consumer of `Observation` was left completely untouched.

## Observation type vs. evidence class

`ObservationType` (`FDA_483_OBSERVATION`/`INSPECTION_OBSERVATION`/
`AUDIT_OBSERVATION`/`PROPRIETARY_OBSERVATION`/
`CLINICAL_OPERATIONS_OBSERVATION`/`OTHER`) answers "what kind of observation
is this." `ObservationEvidenceClass` (`INSPECTION_EVIDENCE`/
`AUDIT_EVIDENCE`/`PRACTICAL_EXPERIENCE`/`INTERNAL_EDUCATIONAL_EVIDENCE`)
answers "what evidentiary weight does it carry" - deliberately a **separate**
enum from `ObservationType`, mirroring Gate 10's `SourceType`/
`SourceAuthority` split, since an FDA 483 observation and an internally
authored educational example are not equally weighted evidence even when
both describe the same kind of finding.

## Evidence / interpretation separation

One of the most important rules in this gate: `ObservationVersion.originalText`
(the verbatim evidence, never edited by this platform) is a structurally
distinct field from `ObservationVersion.interpretationText` (optional,
clearly-derived commentary). The admin UI renders them in visually separate
cards with explicit labeling ("Evidence (verbatim)" vs. "Interpretation
(derived commentary, separate from the evidence above)") so a reviewer can
never mistake one for the other.

## Root cause and expected action: documented vs. inferred

Two more fields kept deliberately separate rather than blurred into one
free-text field:

- `rootCauseCategory` + `rootCauseBasis` (`DOCUMENTED` vs.
  `TRAINING_INFERENCE`) - was the root cause actually stated in the source
  evidence, or is it a training-only inference added for educational value?
- `expectedActionText` + `expectedActionBasis`
  (`DOCUMENTED_CORRECTIVE_ACTION` / `TRAINING_EXPECTED_ACTION` /
  `RECOMMENDED_BEST_PRACTICE`) - three genuinely different claims about "what
  should happen next," never merged into one undifferentiated claim.

CAPA fields (`capaCorrectiveAction`, `capaPreventiveAction`, `capaStatus`,
`capaSource`, `capaDate`) are only ever populated when the source evidence
actually documents a CAPA - there is no default or inferred CAPA.

## Severity and risk (never fabricated)

`ObservationVersion.severity` defaults to `NOT_ASSESSED` (never guessed), and
`riskDimensions` is a native Postgres enum array
(`ObservationRiskDimension[]`) rather than a single subjective "risk score" -
no objective methodology exists for collapsing multiple risk dimensions
(patient safety, data integrity, regulatory compliance, etc.) into one
number, so the platform does not pretend one does.

## Provenance and FDA-483-specific metadata

Generic provenance on `ObservationVersion` (unknown fields left `null` rather
than fabricated): `externalObservationId`, `issuingAuthority`,
`sourceOrganization`, `observationDate`, `publicationDate`, `jurisdiction`,
`country`, `establishmentInfo`, `sourceUrl`, `retrievedAt`,
`provenanceNotes`. FDA-483-specific fields, populated only when the
observation is genuinely an FDA 483 finding: `fda483InspectionId`,
`fda483EstablishmentId`, `fda483InspectionDate`, `fda483InspectionType`,
`fda483ObservationNumber`, `fda483Product`, `fda483InvestigatorInfo`.

## Source linkage (optional, never forced)

`ObservationVersion.sourceId`/`sourceVersionId`/`sourceSectionId` are all
nullable FKs into Gate 10's source architecture, distinct from
`Observation`'s own pre-existing flat `sourceId` - an observation is real-
world evidence, not itself a regulatory source, so linking it to the
regulation it illustrates is optional context, never a requirement.

## GCP domain and professional-role mapping

`ObservationVersion` reuses the existing `Observation.domainId`-adjacent
lookup tables rather than inventing a parallel taxonomy. Because no existing
model in the schema supports a multi-role relationship (every existing model
has only a single nullable `professionalRoleId`-style FK), and Rule 15
explicitly requires "may apply to multiple roles, never forced to one," a new
`ObservationVersionProfessionalRole` join table was added, mirroring the
exactly-precedented `CaseStudyTag` many-to-many pattern already in the
schema. `ObservationVersionCaseStudy` (many-to-many, same pattern) lets one
observation illustrate multiple case studies without forcing a single link.

## De-identification (distinct from external-AI eligibility)

`DeIdentificationStatus` (`NOT_REVIEWED` default / `REVIEW_REQUIRED` /
`DE_IDENTIFIED` / `APPROVED_FOR_INTERNAL_USE` / `APPROVED_FOR_EXTERNAL_AI`)
is a new, orthogonal enum, deliberately separate from the existing
`ExternalAiEligibility` (Gate 6B): "safe to keep internally" and "safe to
send to an external AI provider" are different decisions requiring separate,
explicit human review - neither is inferred from the other, and there is no
automated PII-detection guarantee anywhere in this gate. Human review is
authoritative.

## Lifecycle

`ObservationVersion.reviewStatus` reuses the platform's existing generic
`ContentStatus`/`WorkflowAction` state machine
(`apps/api/src/modules/admin/common/workflow.ts` - the same one programs,
levels, modules, lessons, sources, case studies, and source versions already
use): `DRAFT -> REVIEW -> APPROVED -> PUBLISHED -> ARCHIVED`. No new
lifecycle vocabulary was invented.

- **PUBLISH**, inside one `$transaction`, sets
  `Observation.currentPublishedVersionId` to this version.
- **ARCHIVE**, if applied to the version that is currently
  `Observation.currentPublishedVersionId`, clears that pointer in the same
  transaction, but never deletes or mutates the row's own historical content.

Metadata edits (`PATCH /admin/observation-versions/:id`) are rejected once a
version is `PUBLISHED` or `ARCHIVED` (`VERSION_NOT_EDITABLE`) - a correction
requires registering a new `ObservationVersion`, never an in-place mutation
of published evidence.

## Duplicate detection and hashing (deterministic only, no AI/embeddings)

- `ObservationVersion.contentHash` - SHA-256 of `originalText`. A new version
  whose hash matches any existing version (for the same observation or a
  different one) is rejected with `DUPLICATE_OBSERVATION_VERSION`, naming the
  conflicting observation/version.
- `ObservationVersion.externalObservationId` collision is checked
  independently - the same external identifier (e.g. the same FDA
  observation number) cannot be registered twice.

None of this is semantic/similarity-based; it is exact-content hashing and
exact-identifier matching only.

## Controlled import pipeline (preview-first, not executed at scale in this gate)

```
createBatch  -> validates + deduplicates every record, persists them as
                ObservationImportRow rows with a per-row status (VALID /
                INVALID / DUPLICATE) - NO Observation/ObservationVersion row
                is created yet (dry-run preview only)
previewBatch -> paginated read of the batch's validation outcome
commitBatch  -> creates one ObservationVersion PER VALID ROW ONLY, via the
                same createVersionInternal() path createVersion() uses;
                idempotent at the batch level (a batch may only be committed
                once - status must be PENDING); a per-row failure is recorded
                on that row and the batch is marked PARTIAL rather than
                aborting the remaining rows
```

Normalization (`normalizeRecord`) is deterministic and non-AI: it validates
that `observationType`/`evidenceClass` are real enum members and
`originalText` is non-empty, and passes through any other recognized field
verbatim - it never infers, summarizes, or guesses a missing required field.
Per this gate's explicit scope boundary, no mass import of a real observation
bank was executed; the pipeline is exercised only by small, synthetic,
`SYNTHETIC_TEST_DATA`-labeled fixtures in the test suite.

## Licensing / distribution and external-AI eligibility

`ObservationVersion.accessRestriction`/`license`/`attributionRequired` reuse
Gate 10's `SourceAccessRestriction` enum and pattern exactly. External-AI
eligibility requires **all** applicable conditions to hold, not any single
flag: `externalAiEligibility === SAFE_FOR_EXTERNAL_AI` **and**
`deIdentificationStatus === APPROVED_FOR_EXTERNAL_AI` on the observation's
currently-published version. `GroundingService.buildContext`
(`apps/api/src/modules/ai/grounding/grounding.service.ts`) was extended with
one additional check, placed after its existing legacy-flag observation
check: it only tightens behavior once a published version actually exists,
preserving full backward compatibility with the pre-existing, already-tested
`GroundingService` contract for observations with no version yet. The AI
provider itself never reads the database directly and never decides
eligibility - `GroundingService` is the sole gate.

## Admin API

New `ObservationsModule` controllers, alongside the unmodified Gate 4
`/api/admin/observations` CRUD:

```
POST   /api/admin/observations/:observationId/versions
GET    /api/admin/observations/:observationId/versions   (filter: reviewStatus/
                                                            observationType/evidenceClass/
                                                            deIdentificationStatus)
GET    /api/admin/observation-versions/:id
PATCH  /api/admin/observation-versions/:id
PATCH  /api/admin/observation-versions/:id/status         (generic {action} transition)

POST   /api/admin/observation-imports
GET    /api/admin/observation-imports/:id
GET    /api/admin/observation-imports/:id/preview
POST   /api/admin/observation-imports/:id/commit
```

All list endpoints are paginated (never return unbounded content). Read
access: `CONTENT_AUTHOR`/`REVIEWER`/`ADMIN`. Write access (create/update/
import): `CONTENT_AUTHOR`/`ADMIN`. Lifecycle transitions use the same
per-action role table every other content type already uses
(`SUBMIT_FOR_REVIEW`: author/admin, `APPROVE`/`REJECT`: reviewer/admin,
`PUBLISH`/`ARCHIVE`/`RESTORE`: admin) - backend-enforced regardless of what
the UI shows. **No public or learner-facing observation endpoint exists
anywhere in this gate** - raw observation evidence is never exposed outside
the admin surface.

## Shared contracts

New Zod schemas/types in `@gcp/shared` (`observationVersionSummarySchema`,
`observationVersionDetailSchema`, request schemas for create/update,
`observationImportBatchSchema`, `observationImportRowSchema`,
`createObservationImportRequestSchema`,
`commitObservationImportResultSchema`) - none expose internal storage paths,
secrets, or raw database implementation detail. A new `ObservationErrorCode`
set gives every Gate 11 failure a stable, machine-readable code.

## Audit

New `AuditAction` values: `OBSERVATION_VERSION_CREATED`,
`OBSERVATION_VERSION_METADATA_CHANGED`, `OBSERVATION_VERSION_PUBLISHED`,
`OBSERVATION_VERSION_ARCHIVED`, `OBSERVATION_CLASSIFICATION_CHANGED`,
`OBSERVATION_DEIDENTIFICATION_CHANGED`, `OBSERVATION_AI_ELIGIBILITY_CHANGED`,
`OBSERVATION_SOURCE_LINKAGE_CHANGED`, `OBSERVATION_IMPORT_BATCH_CREATED`,
`OBSERVATION_IMPORT_BATCH_COMMITTED`, `OBSERVATION_IMPORT_BATCH_FAILED`. An
update picks the single most specific applicable action (de-identification
change > source-linkage change > classification change > generic
metadata-changed), so an audit reviewer sees the real nature of a change, not
just "something changed." All audit writes go through the single existing
`AuditService` - no parallel audit mechanism was introduced.

## Admin UI

Reuses `AdminShell`, `RequireRole`, `WorkflowActions`, and the existing
`Badge`/`Card`/`Button` primitives exactly as Gate 10's source admin UI does:

- `/admin/observations` - list + register-new-observation form.
- `/admin/observations/[id]` - observation detail, version list, and
  new-version form (observation type, evidence class, verbatim evidence
  text).
- `/admin/observation-versions/[id]` - the full 19-item reviewer view: verbatim
  evidence (visually separated from interpretation), classification, root
  cause/expected action, CAPA, provenance, FDA-483 metadata,
  de-identification/licensing/AI-eligibility, role/case-study relationships,
  and integrity (content hash, publish/archive timestamps), plus the
  `WorkflowActions` lifecycle control.

Evidence text is rendered as plain React text (`{version.originalText}`),
never `dangerouslySetInnerHTML`.

## Security review

- Authorization: every write route requires `CONTENT_AUTHOR` or `ADMIN`;
  transitions are additionally gated per-action; a `LEARNER` or
  unauthenticated caller is rejected (401/403), verified in e2e tests.
- No public/learner-facing observation endpoint was added - Gate 11 is
  admin-only, per its own scope.
- IDOR: every lookup is by opaque UUID with existence checked before use
  (a nonexistent version ID returns 404 with a stable error code, never a
  leak of internal state).
- Evidence content is rendered as plain text in the admin UI, never
  `dangerouslySetInnerHTML`.

## Performance

List endpoints (`observations`, `observation-versions`, `import preview`)
are paginated using the existing `paginationSkipTake`/`buildPaginatedResult`
helpers; none return an entire evidence bank in one unbounded call. Indexes
were added on `ObservationVersion.observationId/reviewStatus/observationType/
evidenceClass/deIdentificationStatus/externalAiEligibility/contentHash/
externalObservationId` and `ObservationImportBatch.status/observationId` /
`ObservationImportRow.batchId/status` for the query patterns the new
endpoints actually use.

## Tests

Unit (`observation-versions.service.spec.ts`, 22 cases): version creation and
numbering, content-hash and external-ID duplicate rejection, professional-
role/case-study reference validation and linkage, immutability once
PUBLISHED/ARCHIVED, per-field audit-action classification on update, publish/
archive transactional side-effects on `Observation.currentPublishedVersionId`
(including "archiving a non-current version leaves the pointer untouched"),
invalid-transition rejection, and pagination/lookup guards.

Unit (`observation-imports.service.spec.ts`, 12 cases): observation-not-found
rejection, structurally-invalid-record handling, valid-record acceptance,
duplicate detection against both existing versions and within the same
batch, preview pagination without mutating production data, commit
idempotency (`IMPORT_BATCH_NOT_COMMITTABLE` on re-commit), per-row commit
success, and per-row failure handling that marks the batch `PARTIAL` without
aborting the remaining rows.

E2E (`observation-versions.e2e-spec.ts`, 18 cases, real HTTP + real
Postgres): version identity and numbering, documented-vs-inferred root-cause/
expected-action separation, full DRAFT→REVIEW→APPROVED→PUBLISHED lifecycle
with `currentPublishedVersionId` tracking, archive-clears-current-pointer,
immutability of a published version (metadata edit rejected, exact evidence
text unchanged), content-hash and external-ID duplicate rejection, default-
to-`NOT_ASSESSED`/`NOT_REVIEWED` (never fabricated), evidence/interpretation
field separation, the full import batch pipeline (create → preview → commit,
preview-is-a-dry-run, idempotent commit, within-batch duplicate handling),
filtering by observation type, and the full authorization boundary
(unauthenticated, learner, role-restricted transitions, and an IDOR probe
against a nonexistent version ID returning a safe 404).

`GroundingService`'s existing spec gained 3 new cases proving the observation
external-AI boundary (both conditions required; either condition alone is
insufficient) without touching any pre-existing assertion.

## Known limitations

- No mass import of any real observation bank was executed - the import
  pipeline is architecturally complete but has only ever processed small,
  synthetic, `SYNTHETIC_TEST_DATA`-labeled fixtures, per this gate's explicit
  scope boundary.
- `questionGenerationHints` (JSON, on `ObservationVersion`) is schema-only in
  this gate - clearly documented as derived/educational-only, never consumed
  by any generation code path, since the question-generation engine itself is
  out of scope for Gate 11.
- The admin UI covers the Rule 44 review checklist but is intentionally
  modest - list + detail pages reusing existing `AdminShell`/
  `WorkflowActions`, not a rich evidence editor or import wizard (import is
  exercised via the API directly in this gate's tests).
- Search/filtering is exact/structured only (observation type, evidence
  class, review status, de-identification status) - no semantic or vector
  search, by design.
- No automated PII/de-identification detection exists or is claimed anywhere
  in this gate - de-identification status is always a human decision.
