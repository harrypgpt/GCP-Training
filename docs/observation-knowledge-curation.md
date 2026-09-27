# Observation Knowledge Curation (Gate 13)

Gate 13 adds the human-in-the-loop curation layer over the Gate 11/12
Observation Knowledge Foundation: domain/role/risk/severity/root-cause
assignment, controlled training interpretation, learning-objective
linkage (to existing objectives only), regulatory source-link review, and
deterministic case-study/question-generation/training-use readiness. It
never generates a case study, a question, or new training content - it
only prepares evidence, with full traceability, for a later human-reviewed
generation step.

## Evidence hierarchy

1. **Authoritative source** (Gate 10) - ICH/FDA/EMA/official documents.
2. **Regulatory enforcement evidence** (Gate 11/12) - FDA Warning Letters,
   documented inspection observations. Describes what FDA documented in a
   specific context - never automatically equivalent to a regulatory
   requirement.
3. **Practical/expert evidence** (Gate 11/12) - Observation Bank, audit,
   operational observations. Valuable training evidence, never represented
   as an authoritative regulatory requirement unless independently
   supported by a verified Source link.
4. **Training interpretation** (Gate 13, new) - an explicitly curated,
   structurally separate interpretation, always labelled and never
   presented as the original observation.

## Knowledge pipeline stages (never collapsed)

```
SOURCE EVIDENCE (originalText, rawSourceFields, provenance - Gate 11/12, immutable once PUBLISHED)
      |
NORMALIZED EVIDENCE (observationType, evidenceClass, sourceFileName/Sheet/Row - Gate 12)
      |
CURATED KNOWLEDGE (domain, role(s), risk dimension(s), severity, root cause - Gate 13, this file)
      |
TRAINING INTERPRETATION (ObservationTrainingInterpretation - Gate 13, separate model)
      |
LEARNING OBJECTIVE (learningObjectiveId + matchType - links to an EXISTING objective only)
      |
CASE-STUDY READINESS (caseStudyReadiness - metadata only, no narrative generated)
      |
QUESTION-GENERATION READINESS (questionGenerationReadiness - metadata only, no question generated)
```

### Concrete example

```
SOURCE EVIDENCE (originalText, unedited):
"SYNTHETIC_TEST_DATA: FDA documented that audit trail deletion occurred
two days after a pre-announced inspection."

NORMALIZED DATA:
observationType = FDA_WARNING_LETTER_OBSERVATION
evidenceClass   = INSPECTION_EVIDENCE
sourceSheetName = "Computerized Systems"

CURATED KNOWLEDGE:
domain = Computerized Systems Compliance         (basis: HUMAN_CURATED)
riskDimensions = [DATA_INTEGRITY, COMPUTERIZED_SYSTEM]  (basis: SOURCE_EXPLICIT)
severity = HIGH                                   (basis: HUMAN_CURATED)
rootCauseCategory = GOVERNANCE, rootCauseBasis = TRAINING_INFERENCE

TRAINING INTERPRETATION (separate record, separate card in the UI):
"This illustrates why vendor-hosted systems still require sponsor
oversight of audit-trail preservation and deletion controls."
```

The training interpretation is never merged into `originalText`, never
displayed as though FDA wrote it, and is stored as its own
`ObservationTrainingInterpretation` row with its own DRAFT→REVIEW→APPROVED
lifecycle.

## Inspection performed before any schema change (Gate 13 §5)

Before writing any curation code, the following were inspected directly
against the live dev database:

- `GcpDomain`: **0 rows**. No domain-management CRUD exists anywhere in the
  codebase (only a read-only `/admin/gcp-domains` lookup). Domain curation
  is therefore built to function correctly against zero domains today and
  becomes usable the moment domains are added (out of this gate's scope).
- `ProfessionalRole`: 12 seeded rows (CRA, CRC, PRINCIPAL_INVESTIGATOR,
  SUB_INVESTIGATOR, SPONSOR, CRO, CLINICAL_OPERATIONS, QA,
  PHARMACOVIGILANCE, REGULATORY, PHARMACEUTICAL, OTHER) - reused as-is, no
  new vocabulary created.
- `LearningObjective`: **0 rows** (the entire
  Program→Level→Module→Lesson→LearningObjective chain is empty in this
  environment). Learning-objective linkage is therefore built to link only
  to genuinely existing objectives and correctly reports 0 linked in this
  environment - it never fabricates one.
- `CaseStudy`: **0 rows**.
- `ObservationVersion`: 1,834 real rows (Gate 12's import), all DRAFT,
  `domainId`/`rootCauseCategory` unset on all of them, `riskDimensions`
  empty on most, `severity` explicit on 429 rows (411 LOW + 18 HIGH from
  Gate 12's `Nature` mapping), NOT_ASSESSED on the remaining 1,405.
- `RootCauseCategory`/`ObservationRiskDimension`/`ObservationSeverity`
  (Gate 11 enums) were found adequate for Gate 13's needs - **no new
  taxonomy was created** for any of them (see "Controlled vocabulary
  reuse" below).

## Controlled vocabulary reuse (no duplicate systems created)

| Dimension                     | Vocabulary used                                                   | New values added?                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GCP Domain                    | Existing `GcpDomain` table                                        | No                                                                                                                                              |
| Professional role             | Existing `ProfessionalRole` table (12 seeded codes)               | No                                                                                                                                              |
| Root cause category           | Existing Gate 11 `RootCauseCategory` enum                         | No                                                                                                                                              |
| Root cause basis              | Existing Gate 11 `RootCauseBasis` (DOCUMENTED/TRAINING_INFERENCE) | No                                                                                                                                              |
| Risk dimension                | Existing Gate 11 `ObservationRiskDimension` enum                  | No                                                                                                                                              |
| Severity                      | Existing Gate 11 `ObservationSeverity` enum                       | No                                                                                                                                              |
| Classification/curation basis | Existing Gate 12 `ClassificationBasis` enum                       | **Yes** - added `HUMAN_CURATED` (a reviewer has now made this decision, distinct from `HUMAN_REVIEW_REQUIRED`, which only flags one is pending) |

New enums genuinely needed (no existing equivalent):

- `SourceLinkReviewStatus` (VERIFIED / HUMAN_REVIEW_REQUIRED / NOT_LINKED)
- `LearningObjectiveMatchType` (EXACT_EXISTING_MATCH / CURATED_MATCH / HUMAN_REVIEW_REQUIRED / NO_MATCH)
- `ReadinessStatus` (NOT_ASSESSED / NOT_SUITABLE / CANDIDATE / APPROVED) - one shared vocabulary for all three readiness dimensions, since the field name itself already says which dimension is being decided
- `CurationWorkflowStatus` (IMPORTED / CURATION_REQUIRED / IN_REVIEW / CURATED / APPROVED)
- `TrainingInterpretationType` (PRACTICAL_LESSON / RISK_EXPLANATION / VERIFICATION_GUIDANCE / PROFESSIONAL_ACTION / GENERAL)

## Domain curation

`ObservationVersion.domainId` (new, additive, version-scoped FK to
`GcpDomain`) - deliberately **separate** from the existing Gate 4
`Observation.domainId` (identity-level), mirroring the exact
`Observation.sourceId` vs. `ObservationVersion.sourceId` precedent Gate 10/11
already established: the identity-level field is untouched; the new
version-level field carries the curated, evidence-specific decision. Basis
is one of `SOURCE_EXPLICIT` / `DETERMINISTIC_MAPPING` / `HUMAN_CURATED` /
`UNMAPPED`, recorded per-change in `ObservationCurationHistory`.

## Professional role curation

Reuses the existing Gate 11 `ObservationVersionProfessionalRole` join
table (many-to-many, unchanged) with four new additive columns: `basis`,
`rationale`, `curatedById`, `curatedAt`. An observation may be assigned to
multiple roles in one call (`PATCH .../roles` replaces the full set).
Existing (pre-Gate-13) role assignments are backfilled as `HUMAN_CURATED`
since every one was an explicit, caller-supplied choice.

## Risk-dimension and severity curation

Both live directly on `ObservationVersion` (unchanged columns from Gate
11/12). Their curation basis is recorded in the existing
`classificationBasis` JSON map (`{"riskDimensions": "...", "severity":
"..."}`) - reused rather than adding new scalar `*Basis` columns, since
Gate 12 already introduced exactly this per-dimension confidence map.
Severity is never forced into LOW/MODERATE/HIGH/CRITICAL - `NOT_ASSESSED`
remains the honest default until a human (or a documented deterministic
rule) sets it.

## Root-cause curation

`rootCauseCategory` + `rootCauseBasis` (existing Gate 11 columns) are
curated together through one endpoint, always recording
`DOCUMENTED` or `TRAINING_INFERENCE` explicitly - never blurred. The
curation-history entry's own `basis` is always `HUMAN_CURATED` (a human
always makes this specific call), which is a distinct concept from
`rootCauseBasis` (was the root cause itself documented in the source, or a
training-only inference).

## Regulatory source-link review

New `ObservationSourceLinkReview` model - one row per candidate citation
(an observation may cite several authorities, e.g. "21 CFR 312.60; 21 CFR
50.20" contains two). Chain shown in the admin UI:
`Observation → citation text → candidate Source/SourceVersion/SourceSection
→ reviewer → decision (VERIFIED / HUMAN_REVIEW_REQUIRED / NOT_LINKED)`.
`NOT_LINKED` is the default on creation - nothing is ever auto-verified
from pattern matching.

## Training interpretation

New `ObservationTrainingInterpretation` model (1-to-many per version).
Reuses the existing generic `ContentStatus`/`WorkflowAction` DRAFT→REVIEW→
APPROVED machine (`common/workflow.ts`) rather than inventing a parallel
one - no new lifecycle vocabulary. Rendered in a visually separate card
from the verbatim evidence in the admin UI; never auto-published.

## Learning-objective readiness

`ObservationVersion.learningObjectiveMatchType` (new, nullable) records
_how_ the existing `learningObjectiveId` (Gate 11) was set:
`EXACT_EXISTING_MATCH` / `CURATED_MATCH` / `HUMAN_REVIEW_REQUIRED` /
`NO_MATCH`. `NO_MATCH` is itself a complete, deliberate decision ("no
existing objective applies") - distinct from "not yet assessed" (`null`).
**No new LearningObjective is ever created by this gate** - the DTO
validates the referenced id actually exists and rejects otherwise.

## Case-study / question-generation / training-use readiness

Three new `ReadinessStatus` columns on `ObservationVersion`
(`caseStudyReadiness`, `questionGenerationReadiness`,
`trainingUseReadiness`), distinct from Gate 12's import-time heuristic
booleans (`caseStudyCandidate` etc., left untouched). The enum's terminal
state (`APPROVED`) never means a case study or question was generated - it
means the evidence is judged sufficiently curated for a **later**,
separate, human-reviewed generation process (out of this gate's scope by
design).

## Deterministic readiness computation (never a weighted score)

`GET /admin/observation-curation/:id/readiness` computes twelve
independent dimensions (`COMPLETE` / `INCOMPLETE` / `NOT_APPLICABLE` /
`REQUIRES_REVIEW`), each derived from a single, explicit rule over stored
fields - no arbitrary weighting. An overall `knowledgeReadinessState`
(`RAW_IMPORTED` → `PARTIALLY_CURATED` → `CURATION_COMPLETE` →
`TRAINING_READY` → `QUESTION_READY`) is derived from those same
dimensions plus `curationStatus`; `QUESTION_READY` requires
`questionGenerationReadiness === APPROVED` explicitly - it can never be
reached implicitly.

## Curation workflow (Gate 13 §27)

A **second, independent** lifecycle from Gate 11's publish-authority
`reviewStatus`: `IMPORTED → CURATION_REQUIRED → IN_REVIEW → CURATED →
APPROVED`, with `REOPEN_CURATION` returning to `CURATION_REQUIRED` from any
later state. Implemented with the same transitions-table + role-table
pattern as `common/workflow.ts` (`curation-workflow.ts`), not a copy of
that file's states. Authoring actions (start/submit/reopen) require
CONTENT_AUTHOR/ADMIN; review actions (mark-curated/approve) require
REVIEWER/ADMIN. Reaching `APPROVED` here never touches `reviewStatus` -
publishing an `ObservationVersion` remains Gate 11's own, separate,
explicit action.

## Immutability (Gate 13 §32)

Every curation write (domain/role/risk/severity/root-cause/readiness/
learning-objective/source-link-review/training-interpretation) is rejected
with `CURATION_NOT_EDITABLE` (409) once the target `ObservationVersion` is
`PUBLISHED` or `ARCHIVED` - reusing Gate 11's exact immutability rule, not
a new mechanism. A correction on published evidence requires a new
version through the existing Gate 11 versioning flow.

## Audit (Gate 13 §9/§31)

New `ObservationCurationHistory` model - a **dedicated, structured**
per-field change record (field, previousValue, newValue, basis, rationale,
curator, timestamp), preferred over overwriting source data or relying
solely on `AuditLog`'s free-form JSON for a curation-history UI that needs
efficient per-field queries. Every curation write **also** records a
matching `AuditService` entry (new `AuditAction` values:
`OBSERVATION_CURATION_FIELD_CHANGED`, `OBSERVATION_CURATION_STATUS_CHANGED`,
`OBSERVATION_CURATION_BULK_APPLIED`,
`OBSERVATION_SOURCE_LINK_REVIEW_CREATED/DECIDED`,
`OBSERVATION_TRAINING_INTERPRETATION_CREATED/UPDATED/STATUS_CHANGED`) - no
second, parallel audit framework was introduced.

## Bulk curation (Gate 13 §33/§34)

Bounded, deterministic, explicit-row-set only - never an unrestricted
"apply to all":

```
MAX_CURATION_PREVIEW_ROWS = 500
MAX_CURATION_COMMIT_ROWS  = 250
MAX_CURATION_API_ROWS     = 500
MAX_CURATION_UI_PAGE_SIZE = 100
```

`POST .../bulk/preview` returns per-row eligibility (a PUBLISHED/ARCHIVED
row is marked ineligible, never silently skipped) and the proposed change,
without mutating anything. `POST .../bulk/commit` applies the same field/
value/basis/rationale to each eligible row **individually** (one small
update + one history row + one audit entry per row - never one transaction
over the whole selection), then records a single summary
`OBSERVATION_CURATION_BULK_APPLIED` audit entry. Supported bulk fields:
`domain`, `severity`, `riskDimensions`, `caseStudyReadiness`,
`questionGenerationReadiness`, `trainingUseReadiness` (role curation is
scoped to per-row assignment only in this gate - see Known limitations).

## Regulatory integrity guarantees (Gate 13 §37-§41)

- External AI eligibility is **never** escalated by curation - every
  curated version remains `INTERNAL_ONLY` unless a human explicitly
  changes it through the existing Gate 10/11 mechanism, completely
  independent of curation status/readiness.
- FDA Warning Letter evidence and Observation Bank evidence keep their
  `evidenceClass` (`INSPECTION_EVIDENCE` / `PRACTICAL_EXPERIENCE`)
  untouched by curation; a training interpretation is always a separate
  record, never merged into `originalText`.
- No automatic regulatory-claim language ("FDA requires...", "this is a
  GCP violation...") is ever generated - every field this gate writes is
  either a controlled-vocabulary selection made by a human, or a
  deterministic mapping with a recorded basis.

## Admin UI

- `/admin/observation-curation` - the curation queue: baseline summary,
  deterministic filters (evidence class, curation status, domain/role/
  risk/root-cause mapped-or-not, readiness, de-identification, learning-
  objective status), paginated (never loads all 1,834 rows into the
  browser).
- `/admin/observation-curation/[id]` - the curation detail screen: two
  visually separate sections (source evidence vs. curated knowledge),
  workflow actions, per-dimension curation forms, training-interpretation
  and source-link-review management, the readiness matrix, and curation
  history.

## Security (Gate 13 §43)

Every curation route requires `CONTENT_AUTHOR`/`REVIEWER`/`ADMIN`; a
`LEARNER` or unauthenticated caller is rejected (403/401, verified in e2e
tests). Every lookup is by opaque UUID with existence checked before use
(a nonexistent version returns a safe 404, not a leak). No public or
learner-facing curation or observation endpoint exists.

## Performance (Gate 13 §42)

The curation queue uses `paginationSkipTake`/`buildPaginatedResult` with a
server-enforced page-size cap of 100 (the platform's existing pagination
convention). All queue filters map to indexed columns
(`domainId`, `curationStatus`, `caseStudyReadiness`,
`questionGenerationReadiness`, plus the pre-existing Gate 11/12 indexes).
The detail endpoint uses a single Prisma `include` (no N+1) for domain,
roles, source-link reviews, and training interpretations.

## Tests

- Unit: `observation-curation.service.spec.ts` (27 cases - domain/role/
  risk/severity/root-cause/readiness/learning-objective curation,
  immutability, curation-workflow transitions, readiness-summary
  computation, bulk preview/commit/limits),
  `observation-source-link-review.service.spec.ts` (8 cases),
  `observation-training-interpretation.service.spec.ts` (7 cases).
- E2E: `observation-curation.e2e-spec.ts` (25 cases, real HTTP + real
  Postgres, synthetic `GcpDomain`/`TrainingProgram`→`LearningObjective`
  fixtures created and torn down per run) - authorization boundary, IDOR,
  every curation dimension, FDA-vs-expert evidence separation, immutability,
  audit trail, readiness calculation, curation workflow (including the
  reviewer-only role guard), external-AI-eligibility non-escalation, bulk
  preview/commit/limit enforcement, queue filtering, and the baseline
  report.
- Frontend: `observation-curation/page.test.tsx` (3 cases),
  `observation-curation/[id]/page.test.tsx` (3 cases).
- The full pre-existing Gate 1-12 regression suite (API unit, web unit,
  shared unit, and the full e2e suite) was re-run and passes unchanged.

## Known limitations

- Domain and learning-objective curation are architecturally complete but
  cannot be exercised against real data in this environment: `GcpDomain`
  and `LearningObjective` both have zero rows (see "Inspection performed"
  above). Populating them is a prerequisite for real-data domain/LO
  curation, and is explicitly out of this gate's scope (no domain or
  learning-objective was fabricated to work around this).
- Bulk curation supports single-valued/array-scalar fields only (domain,
  severity, riskDimensions, the three readiness dimensions) - bulk
  professional-role reassignment is not implemented in this gate (each
  role assignment already supports multiple roles per single-row call).
- The learning-objective picker in the admin UI is a raw ID field rather
  than a search/autocomplete widget, since there are zero real learning
  objectives to search against in this environment.
- Readiness/completeness dimensions are computed on read (not persisted or
  cached) - correct and simple, at the cost of recomputing on every detail/
  readiness request; at current and near-term data volumes this is not a
  performance concern.
