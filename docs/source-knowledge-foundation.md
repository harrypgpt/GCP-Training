# Source-Document Ingestion & Knowledge Foundation (Gate 10)

Gate 10 gives the platform a controlled, versioned, auditable structure for
authoritative source material - regulatory text, official guidance,
scientific literature, and internal/proprietary reference content - that
later gates (question generation, case-study authoring, AI grounding) can
cite with exact provenance. It is a **knowledge-management system for
education, reference, and traceability**. It is not a regulatory authority:
nothing in this platform determines or certifies regulatory compliance.

## What Gate 10 does NOT implement

Per its own scope boundary, this gate deliberately contains none of:
AI-generated live questions, automatic question publishing, AI grading,
adaptive/predictive learning, semantic duplicate detection, RAG answer
generation, a vector database, an embeddings pipeline, autonomous
regulatory interpretation, an AI tutor/chatbot, an analytics engine, or
large-scale/proprietary case-study ingestion. Extraction is deterministic
and non-AI throughout (see "Ingestion pipeline" below).

## Source architecture: identity vs. version

The Stage 2/4 `Source` model already existed (title, citation, url,
`type: SourceType`, `reviewStatus: ContentStatus`) and is used today by
`CaseStudy.sourceId`, `Observation.sourceId`, `QuestionVersion.sourceId`,
and the Gate 6B AI-generation/candidate tables. Gate 10 treats that row as
the **source's stable identity** and leaves its shape and every existing
foreign key untouched - no existing consumer needed to change.

New, additive structure carries the actual versioned content:

```
Source (identity - unchanged)
  -> SourceVersion (one immutable-once-published revision;
     full provenance/lifecycle/licensing/AI-eligibility/extraction metadata)
    -> SourceSection (structured, exactly-traceable content units;
       self-referencing for nested PART/CHAPTER/SECTION/SUBSECTION)
SourceVersionRelationship (explicit supersedes/references/related_to/
  implements/interprets links between two versions)
```

`Source.currentPublishedVersionId` (new, nullable, unique FK to
`SourceVersion`) mirrors `Question.currentPublishedVersionId` exactly: it
moves forward on each publish; the version it used to point to is never
deleted or mutated, it simply stops being "current" while remaining fully
queryable historically.

## Authority classification

`SourceAuthority` (`AUTHORITATIVE_REGULATORY` / `OFFICIAL_GUIDANCE` /
`SCIENTIFIC_LITERATURE` / `EDUCATIONAL_REFERENCE` / `INTERNAL_EDUCATIONAL` /
`PROPRIETARY_EXPERIENCE`) is a new enum, deliberately **separate** from the
existing `SourceType` (`REGULATION`/`GUIDANCE`/`LITERATURE`/`WHITE_PAPER`/
`PROPRIETARY`/`OBSERVATION`/`OTHER`). `SourceType` answers "what kind of
document is this"; `SourceAuthority` answers "how much regulatory weight do
its statements carry" - a WHITE_PAPER could in principle restate binding
regulation text, so the two axes are never collapsed into one enum. Every
`SourceVersion` carries its own `authority`.

## Provenance

Captured on `SourceVersion`, unknown fields left `null` rather than
fabricated: `issuingOrganization`, `jurisdiction`, `documentVersion` (the
source's own version label, e.g. "R3" - distinct from this platform's
internal `versionNumber`), `revision`, `language`, `canonicalUrl`,
`documentIdentifier`, `publicationDate`, `effectiveDate`, `retrievedAt`,
`provenanceNotes`.

## Lifecycle

`SourceVersion.reviewStatus` reuses the platform's existing generic
`ContentStatus`/`WorkflowAction` state machine
(`apps/api/src/modules/admin/common/workflow.ts` - the same one programs,
levels, modules, lessons, sources, case studies and observations already
use): `DRAFT -> REVIEW -> APPROVED -> PUBLISHED -> ARCHIVED`, with `REJECT`
(REVIEW -> DRAFT) and `RESTORE` (ARCHIVED -> DRAFT). No new lifecycle
vocabulary was invented.

Two version-specific rules layer on top of the generic transition:

- **PUBLISH** requires at least one ingested section (an empty publication
  is rejected with `VERSION_NOT_PUBLISHABLE`), and - inside one
  `$transaction` - sets `Source.currentPublishedVersionId` to this version.
- **ARCHIVE**, if applied to the version that is currently
  `Source.currentPublishedVersionId`, clears that pointer in the same
  transaction (an archived version is no longer "current" knowledge), but
  never deletes or mutates the row's own historical content.

Metadata edits (`PATCH /admin/source-versions/:id`) and further section
ingestion are rejected once a version is `PUBLISHED` or `ARCHIVED`
(`VERSION_NOT_EDITABLE` / `VERSION_NOT_INGESTABLE`) - a correction requires
registering a new `SourceVersion`, never an in-place mutation of published
regulatory text.

## Ingestion pipeline (deterministic, non-AI)

```
SOURCE REGISTRATION (existing Source CRUD, unchanged)
  -> SOURCE VERSION (provenance + licensing + AI-eligibility declared)
    -> SECTION INGESTION (POST .../sections, DRAFT-only)
       - caller supplies exactly what was already extracted OUTSIDE this
         platform (human transcription, or an external deterministic
         parser) - the server never summarizes, paraphrases, infers, or
         corrects text (§12/§30/§59)
       - validation: empty content, duplicate identifiers within a batch,
         self-referential/unresolvable parents are rejected outright
       - upsert by (sourceVersionId, sectionIdentifier): identical content
         is a no-op (idempotent re-run, §39); changed content updates in
         place; new identifiers are created
       - parent references resolved in a second pass so parent and child
         may arrive in either order in the same request
    -> REVIEW -> APPROVAL -> PUBLICATION (generic workflow, above)
```

No file-upload/binary-storage endpoint exists (see "Storage boundary"
below) - ingestion always receives already-extracted structured text as
JSON.

### Extraction method and status

`ExtractionMethod` (`TEXT_LAYER` / `OCR` / `MANUAL` / `OTHER`) records how
each section's text was obtained, recorded per-section (an OCR'd table
sitting inside an otherwise natively-extracted document is not silently
treated as equally precise as the rest). `ExtractionStatus` (`PENDING` /
`EXTRACTED` / `OCR_EXTRACTED` / `NEEDS_REVIEW` / `FAILED` / `APPROVED`)
exists at both the section and the version level; the version's aggregate
status after an ingestion call is the _worst_ status among the sections
just processed (`FAILED` > `NEEDS_REVIEW` > `OCR_EXTRACTED` > `EXTRACTED` >
`PENDING`), so a single problem section is never hidden behind clean
siblings.

### Failure handling (§40)

An ingestion failure sets the version's `extractionStatus` to `FAILED` and
records a controlled `ingestionError` string (never a raw stack trace),
fires a `SOURCE_INGESTION_FAILED` audit event, and re-throws a safe,
stable-error-code exception. Because sections may only be ingested while a
version is `DRAFT`, a failure can never leave a version falsely `APPROVED`
or `PUBLISHED`.

## Section / content-block model

`SourceSection`: `sectionIdentifier` (the document's own numbering, e.g.
"4.3.2", unique within its version), `heading`, `sectionType`
(`HEADING`/`PARAGRAPH`/`LIST`/`TABLE`/`NOTE`/`FOOTNOTE`/`DEFINITION`/
`ANNEX`/`CROSS_REFERENCE`/`OTHER`), `sequence`/`depth` for ordering and
nesting, `parentSectionId` (self-referencing FK), exact `content`, location
metadata (`pdfPageStart`/`pdfPageEnd` vs. `documentPage` - deliberately
never assumed equal, `paragraphRef`, `anchor`), and `crossReferenceText`
(raw, unresolved reference text such as "see Section 5.3" - never
auto-resolved into an invented FK, per §47).

## Hashing and duplicate detection (deterministic only, no AI/embeddings)

- `SourceVersion.checksum` - SHA-256 of the original ingested file/content,
  when supplied. A new version with a checksum matching any existing
  version is rejected with `DUPLICATE_SOURCE_VERSION`, naming the
  conflicting version - never silently merged, always left for a human to
  resolve.
- `SourceSection.contentHash` - SHA-256 of that section's exact content;
  the primary signal used to distinguish "identical re-ingestion" (no-op)
  from "changed content" (update) from "new section" (create).
- `SourceVersion.extractedContentHash` - SHA-256 over the ordered,
  concatenated `(sectionIdentifier, contentHash)` pairs of every currently-
  persisted section, recomputed after each ingestion call - a whole-version
  change/reproducibility signal distinct from the original file's checksum.

None of this is semantic/similarity-based; it is exact-content hashing
only.

## Relationships

`SourceVersionRelationship` (`fromVersionId`, `toVersionId`, `relationType`
one of `SUPERSEDES`/`REFERENCES`/`RELATED_TO`/`IMPLEMENTS`/`INTERPRETS`) is
created only by deliberate admin action - never inferred from titles,
dates, or content similarity.

## Licensing / distribution metadata

`SourceVersion.accessRestriction` (`INTERNAL_KNOWLEDGE_ONLY` default /
`PUBLIC_REDISTRIBUTION_PERMITTED`), `license` (free text), and
`attributionRequired` (boolean, defaults `true`). This is a **separate**
axis from AI eligibility below - one governs redistribution to other
humans/systems, the other specifically governs sending content to an AI
provider.

## External-AI eligibility (Gate 6B integration)

`SourceVersion.externalAiEligibility` reuses the exact
`ExternalAiEligibility` enum (`INTERNAL_ONLY` default / `SAFE_FOR_EXTERNAL_AI`)
that `CaseStudy`/`Observation` already carry, with the same conservative
default. `GroundingService.buildContext` (Gate 6B, `apps/api/src/modules/ai/grounding/grounding.service.ts`)
was extended with one additional check, mirroring its existing case-study/
observation checks exactly: for an external-provider request, a `Source`
is blocked unless its `currentPublishedVersion.externalAiEligibility ===
SAFE_FOR_EXTERNAL_AI`. No published version, or a published version still
`INTERNAL_ONLY`, is treated identically (blocked) - unknown is never
treated as safe. Internal (non-external) grounding requests are unaffected,
preserving the existing, already-tested `GroundingService` contract exactly.

## Training/case/question traceability (prepared, not retrofitted)

Three purely additive, nullable columns were added so future content can
cite exact evidence without disturbing any existing row:
`QuestionVersion.sourceSectionRefId`, `CaseStudy.sourceSectionRefId`,
`Observation.sourceSectionRefId`, each pointing at `SourceSection`. None of
these are populated by Gate 10, none replace the pre-existing free-text
`QuestionVersion.sourceSection` citation or the existing `sourceId`
pointers on any of the three models - they are a forward-looking extension
point only, exercised by no current code path.

## Admin API

Mounted in the existing `SourcesModule`, alongside the unmodified Stage 4
`/api/admin/sources` CRUD:

```
POST   /api/admin/sources/:sourceId/versions
GET    /api/admin/sources/:sourceId/versions
GET    /api/admin/source-versions/:id
PATCH  /api/admin/source-versions/:id
POST   /api/admin/source-versions/:id/sections
GET    /api/admin/source-versions/:id/sections        (search: identifier/heading/content)
PATCH  /api/admin/source-versions/:id/status           (generic {action} transition)
POST   /api/admin/source-versions/:id/relationships
GET    /api/admin/source-versions/:id/relationships
```

All list endpoints are paginated (never return unbounded content). Read
access: `CONTENT_AUTHOR`/`REVIEWER`/`ADMIN`. Write access (create/ingest):
`CONTENT_AUTHOR`/`ADMIN`. Lifecycle transitions use the same
per-action role table every other content type already uses
(`SUBMIT_FOR_REVIEW`: author/admin, `APPROVE`/`REJECT`: reviewer/admin,
`PUBLISH`/`ARCHIVE`/`RESTORE`: admin) - backend-enforced regardless of what
the UI shows.

## Shared contracts

New Zod schemas/types in `@gcp/shared` (`sourceVersionSummarySchema`,
`sourceVersionDetailSchema`, `sourceSectionSchema`,
`sourceVersionRelationshipSchema`, request schemas for create/update/
ingest/relationship) - none expose internal storage paths, secrets, or raw
database implementation detail. A new `SourceErrorCode` set gives every
Gate 10 failure a stable, machine-readable code.

## Audit

New `AuditAction` values: `SOURCE_VERSION_CREATED`,
`SOURCE_VERSION_METADATA_CHANGED`, `SOURCE_INGESTION_STARTED`,
`SOURCE_INGESTION_COMPLETED`, `SOURCE_INGESTION_FAILED`,
`SOURCE_VERSION_PUBLISHED`, `SOURCE_VERSION_ARCHIVED`. Review/approve/
reject/restore reuse the existing generic `CONTENT_APPROVED`/
`CONTENT_MODIFIED` actions, exactly like every other content type. All
audit writes go through the single existing `AuditService` - no parallel
audit mechanism was introduced.

## Storage boundary

No binary file upload or storage abstraction exists in this repository
(`multer`/`@nestjs/platform-express` file interceptors are not wired up
anywhere), so Gate 10 does not add one. Per its own Rule 43/§10, the
ingestion API accepts already-extracted structured text (JSON), and
`SourceVersion` carries metadata _about_ an original file when one exists
(`originalFilename`, `mimeType`, `fileSizeBytes`, `checksum`,
`extractorVersion`) without this platform ever storing or serving the
binary itself. A future gate that adds real binary storage should attach
it at the `SourceVersion` level using these existing fields as the
provenance anchor.

## Answering the Gate 10 audit questions (§63)

For any `SourceSection`: its source (`sourceVersion.source`), its version
(`sourceVersion`, including `versionNumber`/`documentVersion`), its
location (`pdfPageStart`/`documentPage`/`paragraphRef`/`anchor`), when it
was ingested (`sourceVersion.ingestionStartedAt`/`ingestionCompletedAt`),
who approved/published it and when (`sourceVersion.approvedAt`/
`publishedAt`, plus the corresponding `AuditLog` rows), its AI eligibility
(`sourceVersion.externalAiEligibility`), whether it has been superseded
(`SourceVersionRelationship` rows with `relationType: SUPERSEDES`), and
what training/question/case content references it
(`sourceSectionRefId` back-relations, once populated by a future gate) are
all directly queryable.

## Security review

- Authorization: every write route requires `CONTENT_AUTHOR` or `ADMIN`;
  transitions are additionally gated per-action; a `LEARNER` or
  unauthenticated caller is rejected (401/403), verified in e2e tests.
- No public/learner-facing source endpoint was added - Gate 10 is
  admin-only, per its own scope (§23/§24).
- Section content is rendered in the new admin UI as plain React text
  (`{section.content}`), never `dangerouslySetInnerHTML` - no HTML/script
  injection surface was introduced.
- IDOR: every lookup is by opaque UUID with existence checked before use;
  there is no sequential/guessable identifier.

## Performance

List endpoints (`sources`, `source-versions`, `sections`) are paginated
using the existing `paginationSkipTake`/`buildPaginatedResult` helpers;
none return an entire document's content in one unbounded call. Indexes
were added on `SourceVersion.sourceId/reviewStatus/authority/
extractionStatus/externalAiEligibility/checksum` and
`SourceSection.sourceVersionId+sequence/parentSectionId/contentHash` for
the query patterns the new endpoints actually use.

## Tests

Unit (`source-versions.service.spec.ts`, 28 cases): version creation and
numbering, checksum-duplicate rejection, immutability once
PUBLISHED/ARCHIVED, deterministic ingestion (create/update/idempotent
no-op), empty-content and duplicate-identifier rejection, parent
resolution (including same-batch, unresolvable, and self-referential
cases), ingestion-failure handling without leaking raw errors, publish/
archive transactional side-effects on `Source.currentPublishedVersionId`,
relationship creation, and pagination/lookup guards.

E2E (`source-versions.e2e-spec.ts`, 14 cases, real HTTP + real Postgres):
full DRAFT→REVIEW→APPROVED→PUBLISHED lifecycle, publish-requires-sections,
immutability of a published version (metadata edit and further ingestion
both rejected, exact content unchanged), idempotent re-ingestion with
nested parent resolution, unresolvable-parent and duplicate-identifier
rejection, section search, cross-source checksum duplicate detection,
bidirectional relationship traceability, and the full authorization
boundary (unauthenticated, learner, and role-restricted transitions).

`GroundingService`'s existing spec gained 4 new cases proving the source
external-AI boundary without touching any pre-existing assertion.

## Known limitations

- No binary file upload/storage (documented above as a deliberate,
  in-scope boundary, not an oversight).
- The admin UI covers the Rule 44 review checklist (what/who/version/
  status/authority/provenance/sections/extraction/AI-eligibility/
  supersession) but is intentionally modest - list + detail pages reusing
  existing `AdminShell`/`WorkflowActions`, not a rich section editor.
- `sourceSectionRefId` on `QuestionVersion`/`CaseStudy`/`Observation` is
  schema-only in this gate; no authoring UI sets it yet.
- Search is exact/structured only (title, identifier, heading, content
  substring, status, authority) - no semantic or vector search, by design.
