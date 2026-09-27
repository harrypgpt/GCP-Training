# Real Observation Data Normalization & Controlled Import (Gate 12)

Gate 12 builds the pipeline that introduces the project's REAL observation
evidence into the Gate 11 Observation Knowledge Foundation: two real
datasets, profiled, normalized deterministically (no AI), classified
conservatively, and committed as DRAFT `ObservationVersion` rows - never
published automatically, never exposed publicly.

## Source datasets

| Dataset                          | File                                                                  | Sheets actually imported                                   | Real rows imported                          |
| -------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| A — Observation Bank             | `Observation Bank_2025.xlsx`                                          | ` Clinical` (1100), `Bio-analytical` (159), ` Audit` (577) | 1,833 (3 rows skipped: empty evidence text) |
| B — FDA Warning Letters (master) | `FDA_Clinical_Research_Warning_Letters_Observations_Extract.xlsx`     | `Warning Letters` (26), `Computerized Systems` (9)         | 35                                          |
| C — FDA Warning Letters (older)  | `FDA_Clinical_Research_Warning_Letters_Observations_Extract (1).xlsx` | —                                                          | **0 (not imported - see Reconciliation)**   |

Total real `ObservationVersion` rows committed: **1,834** (1,799 unique
Observation Bank rows after cross-batch duplicate removal + 35 FDA rows).
Every one of the three original workbooks was copied - never moved or
modified - into `data/imports/observations/raw/`; the originals under
`Database/` were left untouched.

### Sheets NOT imported

- `Observation Bank_2025.xlsx` → `Trend` (a pivot/summary sheet, not
  individual observation records).
- Both FDA workbooks → `Read Me`, `Executive Summary` (documentation), and
  (master only) `Observation Themes`, `Software Compliance Themes`
  (thematic roll-ups of the 35 real observations, not themselves individual
  observation records - importing them as observations would misrepresent
  a summary as primary evidence).

## Dataset reconciliation (B vs C)

`reconcileFdaWorkbooks` (`src/modules/admin/observations/import-normalization.ts`)
compares every sheet the two FDA workbooks share. Result: the **only**
sheets that ever feed an `ObservationVersion` (`Warning Letters`,
`Computerized Systems`) are either byte-identical between the two files
(`Warning Letters`: 26/26 rows identical) or exist only in the master
(`Computerized Systems`, `Software Compliance Themes`). `Read Me`/
`Executive Summary` differ slightly in wording (documentation, not data)
and do not affect the decision. **Conclusion: workbook C is a strict
subset of workbook B and is not imported at all** - not deleted, not
independently ingested, fully reconciled-and-superseded. Had the
observation-bearing sheets actually conflicted, the pipeline's decision
text would say so explicitly and require manual reconciliation - it never
silently picks a side.

## Evidence classification

| Source                                          | `ObservationType`                                | `ObservationEvidenceClass` | Basis                            |
| ----------------------------------------------- | ------------------------------------------------ | -------------------------- | -------------------------------- |
| Observation Bank " Clinical"/" Bio-analytical " | `CLINICAL_OPERATIONS_OBSERVATION`                | `PRACTICAL_EXPERIENCE`     | SOURCE_EXPLICIT (sheet identity) |
| Observation Bank " Audit"                       | `AUDIT_OBSERVATION`                              | `PRACTICAL_EXPERIENCE`     | SOURCE_EXPLICIT                  |
| FDA "Warning Letters" / "Computerized Systems"  | `FDA_WARNING_LETTER_OBSERVATION` (**new value**) | `INSPECTION_EVIDENCE`      | SOURCE_EXPLICIT                  |

**Why a new `ObservationType` value was added:** an FDA Warning Letter is a
distinct, more severe legal enforcement document than a Form 483 finding.
Gate 11's existing `FDA_483_OBSERVATION` value specifically means a Form
483; reusing it for Warning Letter text would misrepresent what kind of
document this evidence actually is (Gate 12 explicitly forbids exactly
this: "Do not falsely represent these records as FDA findings unless the
source explicitly establishes that"). No other new `ObservationType` or
`ObservationEvidenceClass` value was needed - the existing
`CLINICAL_OPERATIONS_OBSERVATION`/`AUDIT_OBSERVATION`/`PRACTICAL_EXPERIENCE`/
`INSPECTION_EVIDENCE` values were already sufficient once each row's
originating dataset+sheet is known (always SOURCE_EXPLICIT, never inferred
from ambiguous text).

## Controlled vocabulary mapping - what IS and is NOT mapped

A new `ClassificationBasis` enum (`SOURCE_EXPLICIT` / `DETERMINISTIC_MAPPING`
/ `HUMAN_REVIEW_REQUIRED` / `UNMAPPED`) is recorded per classified dimension
on every imported `ObservationVersion.classificationBasis` (a JSON map,
e.g. `{"observationType":"SOURCE_EXPLICIT","domain":"UNMAPPED"}`), so no
classification decision is ever hidden.

| Dimension                                             | Mapped?                  | Basis                                                     | Why                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observationType`, `evidenceClass`                    | Yes                      | SOURCE_EXPLICIT                                           | Determined by which dataset/sheet the row came from - not inferred from text.                                                                                                                                                                                                                                              |
| `severity` (Observation Bank only)                    | Partial                  | DETERMINISTIC_MAPPING when `Nature` is set, else UNMAPPED | Small fixed table: `Minor→LOW`, `Major→HIGH`, `Non significant→LOW`, `GAPs→LOW`. `Nature` is blank on ~76% of rows - severity is honestly `NOT_ASSESSED` for those, never guessed.                                                                                                                                         |
| `riskDimensions` (FDA "Computerized Systems" only)    | Yes                      | SOURCE_EXPLICIT                                           | Tagged `COMPUTERIZED_SYSTEM` because the row came from that specific sheet - not because the observation text was pattern-matched.                                                                                                                                                                                         |
| `expectedActionText`/`expectedActionBasis` (FDA only) | Yes                      | SOURCE_EXPLICIT                                           | The "CAPA / requested action" / "Response / CAPA" column maps directly to `expectedActionBasis = DOCUMENTED_CORRECTIVE_ACTION` - this is what FDA is documented as _requesting_, deliberately NOT written into the `capa*` fields (which imply confirmed implementation/verification status this data does not establish). |
| `domain` (GcpDomain)                                  | **No - always UNMAPPED** | —                                                         | `GcpDomain` has zero seeded rows in this environment; there is nothing to map to, and free-text `Area`/`BIMO Area` values are too heterogeneous (833/106/445 distinct values across the three Observation Bank sheets) to map deterministically without risking invented classification.                                   |
| `professionalRole`                                    | **No - always UNMAPPED** | —                                                         | Same reasoning; deferred entirely to human curation via the existing admin UI (`professionalRoleIds` on `PATCH /admin/observation-versions/:id`).                                                                                                                                                                          |
| `rootCauseCategory`                                   | **No - always UNMAPPED** | —                                                         | No reliable deterministic signal exists in either dataset for this controlled vocabulary.                                                                                                                                                                                                                                  |

**This is a deliberate, conservative choice, not an oversight**: Gate 12
explicitly warns "Do not invent classifications merely because a text
appears to suggest them." Rather than build a fragile keyword-guessing
mapper for domain/role/root-cause, every such row is left `UNMAPPED` and
visible as such in the admin UI, for a human to fill in with actual
judgment whenever convenient - this never blocks import or lifecycle
progress.

## De-identification (conservative, human-authoritative)

`deidentificationStatusFor` (`import-normalization.ts`) is a small,
non-exhaustive regex heuristic - it matches explicit subject/patient
number patterns (`Subject No. 24`, `subject 74`), `patient id`, `initials:`,
date-of-birth/DOB/MRN/SSN/phone/email-shaped text. It **only ever** produces
`DeIdentificationStatus.REVIEW_REQUIRED` (a flag for a human) or leaves the
Gate 11 default `NOT_REVIEWED` - it never asserts a record is safe, never
redacts or deletes text, and is not claimed to be comprehensive PII
detection. **226 of 1,834** imported rows were flagged `REVIEW_REQUIRED`
(228 rows matched the pattern; 2 were later excluded as cross-batch
duplicates). No row was ever set to `DE_IDENTIFIED` or
`APPROVED_FOR_EXTERNAL_AI` by the pipeline - those states require an
explicit human decision, exactly as Gate 11 designed.

## Raw-source preservation and provenance

Every imported `ObservationVersion` carries (new, additive columns):
`sourceFileName`, `sourceSheetName`, `sourceRowNumber` (the workbook's own
row number, header row = 1), and `rawSourceFields` (a JSON map of every
source column that doesn't have a dedicated canonical field - e.g. `Area`,
`Molecules`, `BIMO Area`, `Response available`, `Key control lesson` -
preserved verbatim rather than discarded). A reviewer can answer "where
exactly did this originate" from the version detail page alone, without
reading application logs.

## RAW vs. NORMALIZED vs. TRAINING/INFERENCE

- **RAW** = `rawSourceFields` (untouched source columns) plus the source
  workbook/sheet/row provenance fields.
- **NORMALIZED** = `originalText` (verbatim evidence, never edited),
  `observationType`/`evidenceClass`/`severity`/`riskDimensions` (controlled
  vocabulary the pipeline assigned, always tagged with its
  `classificationBasis`).
- **TRAINING/INFERENCE** = `interpretationText` - deliberately left
  **empty by this pipeline** for every imported row. Gate 12 requires that
  any training-added interpretation never be presented as if part of the
  original evidence; since no interpretation is generated in this gate,
  there is nothing to conflate. A future human reviewer may add
  `interpretationText` later via the existing admin UI, and it will render
  in a visually separate card from the verbatim evidence exactly as Gate 11
  designed.

## FDA Warning Letter field mapping

| Canonical field                              | Workbook column                                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `externalObservationId`                      | `FDA Ref`                                                                                                                                                                                                           |
| `originalText`                               | `Main FDA observation` (Warning Letters sheet) / `FDA observation` (Computerized Systems sheet)                                                                                                                     |
| `issuingAuthority`                           | (constant) `FDA`                                                                                                                                                                                                    |
| `sourceOrganization`                         | `Recipient`                                                                                                                                                                                                         |
| `jurisdiction`                               | `Country` (Warning Letters sheet only)                                                                                                                                                                              |
| `observationDate`                            | `Date`                                                                                                                                                                                                              |
| `sourceUrl`                                  | `Source`                                                                                                                                                                                                            |
| `expectedActionText` / `expectedActionBasis` | `CAPA / requested action` / `Response / CAPA` → `DOCUMENTED_CORRECTIVE_ACTION`                                                                                                                                      |
| `riskDimensions`                             | (Computerized Systems only) → `['COMPUTERIZED_SYSTEM']`                                                                                                                                                             |
| `rawSourceFields`                            | `Role/Type`, `FDA Center`, `BIMO Area`, `21 CFR / Authority`, `Response available`, `FDA response assessment`, `Clinical research relevance`, `System / technology`, `Area`, `Why it matters`, `Key control lesson` |

No FDA metadata was ever fabricated. A row missing `FDA Ref` or its
observation text is skipped (not imported with an invented identifier).

## Observation Bank field mapping

| Canonical field      | Workbook column                                                      |
| -------------------- | -------------------------------------------------------------------- |
| `originalText`       | `Observation Details`                                                |
| `sourceOrganization` | `CRO`                                                                |
| `severity`           | `Nature` (see table above)                                           |
| `rawSourceFields`    | `Area`, `Molecules` (Clinical/Bio-analytical), `Audit` (Audit sheet) |

`observationCode` is generated deterministically from the sheet's own
`Sr.No.` column (`OBS-OBK-CLINICAL-000001`, `OBS-OBK-BIOANALYTICAL-000001`,
`OBS-OBK-AUDIT-000001`, zero-padded, never reused across sheets).

## Provenance linkage to authoritative sources

**No `sourceId`/`sourceVersionId`/`sourceSectionId` linkage was created for
any imported row.** Gate 12 explicitly requires this relationship only be
created "when that relationship is verifiable from the imported data" -
citations like "21 CFR 312.60" are preserved verbatim in `rawSourceFields`,
but there is no deterministic, verified mapping from a bare citation string
to a specific existing `SourceSection` row in this environment. Inferring
one would violate the explicit rule "FDA Warning Letter observation ≠
regulatory requirement" and "do not infer source relationships merely
because the observation appears related to a known regulation."

## Architecture: bulk-mode import (the one Gate 11 extension this gate required)

Gate 11's `ObservationImportBatch.observationId` was designed for a
narrower case: adding corrected versions to ONE already-known Observation
over time (a required, non-null FK). Gate 12 needed to import ~1,868
DISTINCT real-world observations, each of which should be its own
Observation identity, not 1,868 versions of one umbrella row. Rather than
build a second, parallel import architecture, `ObservationImportBatch
.observationId` was made **nullable** (a single additive column-widening
migration): a batch with `observationId` set behaves exactly as Gate 11
originally built it; a batch with it omitted is **bulk mode** - each row
carries its own `observationCode`, and `ObservationImportsService
.findOrCreateObservationForImport` resolves-or-creates that Observation
identity at commit time (race-safe: a `P2002` unique-constraint conflict
falls back to re-reading the winning row rather than erroring). Re-running
the same normalized data twice reuses the existing Observation identity and
is caught as a content-hash duplicate at the version level - it never
creates a second Observation for the same code.

## New schema (all additive; every existing Gate 10/11 column, index and row untouched)

- `ObservationType.FDA_WARNING_LETTER_OBSERVATION` (new enum value).
- `ClassificationBasis` (new enum: `SOURCE_EXPLICIT` / `DETERMINISTIC_MAPPING` / `HUMAN_REVIEW_REQUIRED` / `UNMAPPED`).
- `ObservationVersion`: `sourceFileName`, `sourceSheetName`, `sourceRowNumber`, `classificationBasis` (Json), `rawSourceFields` (Json), `caseStudyCandidate`/`questionGenerationCandidate`/`trainingUseCandidate` (Booleans, default `false`).
- `ObservationImportBatch`: `observationId` relaxed to nullable, `normalizationVersion` (String?), `warningCount` (Int, default 0).
- `ObservationImportRow`: `warnings` (Json?, parallel to the existing `errors`).

Migration: `20261020000000_gate12_observation_normalization_import` - pure
`CREATE TYPE`/`ALTER TYPE ... ADD VALUE`/`ADD COLUMN`/`CREATE INDEX`; no
`DROP`, no `DELETE`, no `_prisma_migrations` manipulation.

## Row warnings vs. errors

`ObservationImportRow.errors` = blocking (row is `INVALID`, never
committed). `ObservationImportRow.warnings` = non-blocking (row is still
`VALID`/committable) - triggered **only** by a `classificationBasis` entry
of `HUMAN_REVIEW_REQUIRED` or a `deIdentificationStatus` of
`REVIEW_REQUIRED`. `UNMAPPED` is deliberately **not** a warning - it is the
honest, expected outcome for domain/role/root-cause on nearly every row
(see table above), and flagging it on all 1,834 rows would drown out the
226 genuinely actionable de-identification flags in noise.

## Import lifecycle actually executed

```
normalize-observations.ts   (pure, offline; reads data/imports/observations/raw/*.xlsx,
                              writes normalized/*.json + reports/*.{json,md})
        ↓
import-observations.ts      (NestJS standalone context; chunks records into
                              ≤500-row batches; calls the EXISTING
                              ObservationImportsService.createBatch/commitBatch -
                              no import logic is reimplemented)
        ↓
5 batches created, previewed, and committed:
  - Observation Bank: 4 batches (500/500/500/333 records)
  - FDA Warning Letters: 1 batch (35 records)
        ↓
1,834 ObservationVersion rows created, ALL status = DRAFT
```

No batch was ever auto-published. Publishing remains a separate, explicit
`WorkflowAction` on each version individually, exactly as Gate 11 built it.
The import was attributed to a newly-created, durable
`data-import-admin@gcp-training.local` ADMIN account (not a leftover e2e
test fixture user), per the user's explicit choice.

## Admin UI

- `/admin/observation-imports` - batch list: dataset label, bulk-mode
  indicator, accepted/total, warning/duplicate counts, status.
- `/admin/observation-imports/[id]` - batch detail: mode, source file,
  normalization version, full counts, a commit action (only while
  `PENDING`), and a per-row preview showing status/errors/warnings and a
  link to the created version once committed.
- `/admin/observation-versions/[id]` - gained an "Import provenance &
  classification" card: source file/sheet/row, per-dimension
  classification confidence, preserved raw source fields, and the
  case-study/question-generation/training-use readiness flags - shown only
  for imported versions.

## AI boundary (unchanged)

No AI classification, embeddings, semantic search, or content generation
was used anywhere in this pipeline. `GroundingService`'s eligibility check
(Gate 10/11) is untouched: every imported version defaults to
`externalAiEligibility: INTERNAL_ONLY`, and reaching an external AI
provider still requires an explicit, separate human decision plus
`deIdentificationStatus: APPROVED_FOR_EXTERNAL_AI` on top of it.

## Security

All import endpoints remain `CONTENT_AUTHOR`/`ADMIN`-only
(`ObservationImportsController`); a `LEARNER` or unauthenticated caller is
rejected (401/403, verified in e2e tests). No public or learner-facing
observation endpoint exists. Committed evidence text is rendered as plain
React text in the admin UI, never `dangerouslySetInnerHTML`.

## Tests

- Unit (`import-normalization.spec.ts`, 16 cases): Nature→severity mapping,
  deterministic observationCode generation, CRO/Area/Molecules
  preservation, empty-evidence skipping, de-identification flagging,
  UNMAPPED-never-fabricated assertions, FDA field mapping, Warning-Letter-
  vs-483 type distinctness, Computerized-Systems risk-dimension tagging,
  and workbook reconciliation (identical vs. genuinely conflicting sheets).
- Unit (`observation-imports.service.spec.ts`, +7 Gate 12 cases): bulk-mode
  batch creation without a pre-existing Observation, missing-observationCode
  rejection, find-or-create-by-code at commit, idempotent reuse of an
  existing identity, provenance/classificationBasis/rawSourceFields
  round-tripping, HUMAN_REVIEW_REQUIRED-vs-UNMAPPED warning behavior, and a
  race-safe concurrent-create fallback.
- E2E (`observation-bulk-import.e2e-spec.ts`, 6 cases, real HTTP + real
  Postgres): distinct Observation identities per bulk row, provenance/
  classification persistence end-to-end, idempotent re-run onto the same
  identity, invalid-row rejection, `FDA_WARNING_LETTER_OBSERVATION`
  acceptance, and the learner-authorization boundary.
- The full pre-existing Gate 1-11 regression suite (API unit, web unit,
  shared unit, and the full e2e suite) was re-run and passes unchanged.

## Known limitations / human-review requirements

- `domain`/`professionalRole`/`rootCauseCategory` are `UNMAPPED` on every
  imported row - by design, pending human curation. `GcpDomain` has zero
  seeded rows in this environment; populating it is a prerequisite for any
  future domain-mapping attempt.
- The de-identification heuristic is intentionally narrow (a handful of
  regex patterns) and is not, and does not claim to be, comprehensive PII
  detection. Every imported row remains `NOT_REVIEWED` or
  `REVIEW_REQUIRED` - never `DE_IDENTIFIED`/`APPROVED_FOR_*` - until a
  human explicitly reviews it.
- No source/regulation linkage was established for any row (see
  "Provenance linkage" above) - this is a deliberate conservative choice,
  not a gap to silently fill later with guesses.
- `caseStudyCandidate`/`questionGenerationCandidate`/`trainingUseCandidate`
  are readiness flags only; no case study, question, or narrative content
  was generated by this gate.
- Retry-safety is guaranteed at the batch level (a completed/failed batch
  cannot be re-committed) and at the Observation-identity level (find-or-
  create by code, race-safe); it does not attempt to resume a batch that
  crashed mid-commit - a fresh batch from the same normalized JSON is the
  supported recovery path, and duplicate detection prevents it from
  double-importing anything already committed.
