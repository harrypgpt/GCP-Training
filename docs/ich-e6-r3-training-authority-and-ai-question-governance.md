# ICH E6(R3) Training Authority & AI Question Governance (Gate 18)

Gate 18 is a governance and architecture-hardening gate. It adds no new AI
provider, no new question bank, and no new grounding service - it
technically enforces a rule that was previously only a convention: **ICH
E6(R3) is the sole normative GCP authority on this platform, and no
real-world observation (FDA Warning Letter, FDA 483, practical, expert, ...)
may ever independently establish what GCP requires.**

## 1. Authoritative source

The only normative training authority is:

> ICH Harmonised Guideline, Guideline for Good Clinical Practice, E6(R3),
> Final Version, adopted 06 January 2025.
> `https://database.ich.org/sites/default/files/ICH_E6(R3)_Step4_FinalGuideline_2025_0106.pdf`

It is registered once, via `pnpm --filter @gcp/api gate18:register-ich-e6r3`
(`apps/api/scripts/register-ich-e6r3.ts`), using the **existing** Gate 10
`Source`/`SourceVersion`/`SourceSection` architecture - no parallel source
system was created. Every section's text was copied **verbatim** from the
official PDF (fetched and text-extracted with `pdftotext -layout`); nothing
was invented, summarized, or paraphrased, and the document's own section
numbering (`I`, `II`, `II.7`, `2.5`, `2.8`, `4.3.3`, `4.3.4`, ...) is used
exactly as printed.

## 2. Source hierarchy (existing enums, reused unchanged)

- `Source.type = GUIDANCE` (it is literally titled a "Guideline").
- `SourceVersion.authority = AUTHORITATIVE_REGULATORY` - the strongest
  existing authority value; no new enum member was added.
- `SourceVersion.accessRestriction = PUBLIC_REDISTRIBUTION_PERMITTED` - ICH's
  own legal notice on the document explicitly permits reproduction with
  attribution.
- `SourceVersion.externalAiEligibility = SAFE_FOR_EXTERNAL_AI` - a deliberate
  editorial decision (Gate 18 §6), since the document is public with no
  confidentiality/PII concern, set once the version was fully ingested.
- `SourceVersion.reviewStatus` follows the same generic
  DRAFT→REVIEW→APPROVED→PUBLISHED workflow every other Source uses - only a
  **PUBLISHED** version may ground a question (Gate 18 §14/§25).

## 3. Normative vs. scenario distinction

|                                  | CATEGORY A - Normative GCP knowledge                                                  | CATEGORY B - Real-world case-study knowledge                            |
| -------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Source                           | ICH E6(R3) only                                                                       | FDA Warning Letters, FDA 483s, audit/practical/expert observations      |
| Used for                         | training content, GCP principles/requirements, correct answers, rationales, citations | realistic scenarios, failure patterns, operational context, distractors |
| May it define a GCP requirement? | Yes - it is the requirement                                                           | **Never**                                                               |

The forbidden transformation - `FDA observation -> GCP requirement` (or
`expert observation ->`, `practical observation ->`, `audit observation ->`)

- is structurally impossible in this gate's code path: a
  `CaseStudyQuestionGenerationService.generate()` call cannot even be invoked
  without `normativeSourceSectionIds` (a required DTO field, minimum 1), and
  `GroundingService.loadNormativeGcpSections()` verifies that reference is
  the real, published ICH E6(R3) document before anything is generated.

## 4. DIRECT_GCP

TYPE 1: a question testing knowledge directly derivable from ICH E6(R3) -
no observation or case study is required, accepted, or referenced.
`CaseStudyQuestionGenerationService.generateDirectGcp()` +
`POST /api/admin/direct-gcp-questions/generate` (CONTENT_AUTHOR/ADMIN only).
Persisted as `questionGenerationType = DIRECT_GCP`,
`scenarioSourceType = NONE`, `caseStudyVersionId = null`,
`observationId = null`.

## 5. CASE_APPLICATION

TYPE 2: a realistic scenario from the observation/case-study knowledge base
(Gate 15/16), whose answer/rationale is grounded in a **separately
labelled** ICH E6(R3) section.
`CaseStudyQuestionGenerationService.generate()` (Gate 17, extended) +
`POST /api/admin/case-studies/:caseStudyId/versions/:versionId/generate-question`.
`scenarioSourceType` is derived **deterministically** from the real
observation's own `observationType`/`evidenceClass`
(`deriveScenarioSourceType()`) - never an AI classification:

```
FDA_WARNING_LETTER_OBSERVATION -> FDA_WARNING_LETTER
FDA_483_OBSERVATION            -> FDA_483
evidenceClass = PRACTICAL_EXPERIENCE -> PRACTICAL_OBSERVATION
PROPRIETARY_OBSERVATION        -> EXPERT_OBSERVATION
(anything else)                -> OTHER_APPROVED_CASE_EVIDENCE
```

## 6. AI's role

Gemini/OpenAI/Mock (unchanged provider architecture, Gate 17) never decide
what ICH E6(R3) means, whether an FDA observation creates a GCP obligation,
whether a statement is a regulatory requirement, or whether a question is
suitable for certification. The server resolves and validates the
grounding; the AI produces a candidate; the server validates it again,
deterministically; a human reviews it. Only an explicit human ACCEPT, then
an explicit conversion, then the pre-existing Question workflow can ever
make content publishable - never automatically.

## 7. Human review (unchanged, Gate 15/17)

`AiCandidatesService.accept/reject` and `AiCandidateConversionService.convert`
are reused completely unmodified. Conversion always creates a brand-new
**DRAFT** `Question`/`QuestionVersion` - accepting a candidate never
publishes it.

## 8. Grounding architecture

`GroundingService` (one service, extended, never duplicated) now exposes:

- `buildQuestionContextFromCaseStudy()` (Gate 17, unchanged) - the CASE
  CONTEXT.
- `loadNormativeGcpSections()` (new) - the NORMATIVE_GCP_CONTEXT: loads real
  `SourceSection` rows, verifies they belong to the registered ICH E6(R3)
  document (`documentIdentifier === 'E6(R3)'` and
  `issuingOrganization === 'ICH'` - not merely "some regulation-typed
  Source"), verifies the `SourceVersion` is `PUBLISHED`, and re-applies the
  external-AI eligibility check for an external provider.

For a CASE_APPLICATION question, the two contexts are combined into one
prompt with two clearly labelled blocks:

```
[NORMATIVE GCP SOURCE]
ICH E6(R3) - Guideline for Good Clinical Practice
Section 4.3.3 - Data Governance - Computerised Systems - Security:
<verbatim ICH text>

[CASE STUDY EVIDENCE]
Case: SPEC-... - <title>
Scenario: <case-study scenario>
Observed evidence: <the real observation's original text>
Approved training interpretation: <if any>
```

The prompt explicitly states which block is normative and which is
contextual (see `ich-e6r3-question-generation.prompt.ts`).

## 9. Validation rules

Two deterministic validators run on every candidate, neither trusting the
model's self-report:

- `validateAiQuestionOutput` (Gate 15/17, unchanged except the Gate 20 fix
  below) - structural/content quality: stem/options/correct-answer
  presence, no duplicate options, no answer leakage, citation-vs-source
  consistency, evidence-reference matching against `knownLabels`.
- `validateQuestionGovernance` (new, Gate 18 §35) - PROVENANCE only: valid
  question-generation type; normative source is `ICH_E6_R3`; its
  `SourceVersion` is `PUBLISHED`; a specific section is cited; source-role
  purity (a DIRECT_GCP candidate carries no scenario source, a
  CASE_APPLICATION candidate carries one); the case-study version and its
  training interpretation, if any, are approved; a missing learning
  objective is an explicit `NO_MATCH`/`HUMAN_REVIEW_REQUIRED` decision, not
  a silent gap.

Either validator failing sets `candidateStatus = VALIDATION_FAILED` - the
same terminal-but-reviewable state the pipeline already used, never a new
status value. `validateQuestionGovernance` deliberately does **not**
re-implement unsupported-claim detection - that is already
`validateAiQuestionOutput`'s job, and it works correctly here because
`GroundingContext.source` is now populated with the _real_ ICH reference
instead of staying null.

## 10. Provenance / traceability

Every candidate records real, queryable foreign keys:
`questionGenerationType`, `normativeSource`, `normativeSourceVersionId`
(FK → `SourceVersion`), `normativeSourceSectionId` (FK → `SourceSection`),
`scenarioSourceType`, `caseStudyVersionId` (FK → `CaseStudyVersion`, Gate
17), `observationId`, `runId` (→ `AiGenerationRun`, whose
`promptTemplateVersion` records the exact prompt used). The full chain -
`Observation → ObservationVersion → TrainingInterpretation →
CaseStudySpecification → CaseStudyVersion → AiGenerationRun (+ normative
SourceVersion/SourceSection) → AiQuestionCandidate → reviewer → converted
Question (DRAFT)` - is reconstructable by ID alone, proven by e2e test.

## 11. FDA observation handling

An FDA Warning Letter or Form 483 observation is `scenarioSourceType =
FDA_WARNING_LETTER`/`FDA_483` - contextual evidence only. It can never
become the candidate's `normativeSource` (that field is hard-coded to
`ICH_E6_R3` whenever it is set at all) and can never ground the
answer/rationale on its own - `validateQuestionGovernance` blocks any
candidate lacking real ICH E6(R3) grounding regardless of how rich the FDA
evidence is.

## 12. Expert/practical observation handling

Handled identically to FDA evidence: `scenarioSourceType =
EXPERT_OBSERVATION`/`PRACTICAL_OBSERVATION`, contextual only, never a
normative source. (At the time of this gate, the real curated observation
bank contains zero `PROPRIETARY_OBSERVATION` ["expert observation"] rows -
see Known Limitations.)

## 13. Source versioning

Unchanged Gate 10 behaviour: a `SourceVersion` becomes immutable once
`PUBLISHED`/`ARCHIVED`. If the official ICH E6(R3) text is ever revised, a
**new** `SourceVersion` must be created (`SourceVersionsService.createVersion`)

- the published version already in use by approved questions is never
  edited in place. Proven by e2e test (an unpublished/DRAFT second
  `SourceVersion` of the same real ICH `Source` is correctly blocked from
  grounding anything).

## 14. Licensing

ICH's own Legal Notice on the document permits reproduction, incorporation
into other works, and distribution under a public licence, provided ICH's
copyright is acknowledged - recorded verbatim in
`SourceVersion.license`/`attributionRequired = true`.

## 15. Security

- `GENERATE_ROLES = [CONTENT_AUTHOR, ADMIN]` on both the CASE_APPLICATION
  and DIRECT_GCP generation endpoints; a learner or unauthenticated caller
  is rejected (403/401) - proven by e2e test for both endpoints.
- External-AI eligibility is re-checked for the normative source
  independently of the case-study/observation check already established in
  Gate 15/17 - an `INTERNAL_ONLY` normative version is blocked before any
  provider call, exactly like an `INTERNAL_ONLY` observation.
- No API key of any kind is read outside `AppConfigService`; none appears in
  logs, responses, or generated records (unchanged from Gate 17).
- IDOR: candidate/question access checks are unchanged from Gate 15/17 -
  Gate 18 adds no new object-access surface.

## 16. Metrics / real-data verification

`pnpm --filter @gcp/api gate18:real-tranche` generated 6 candidates (1
DIRECT_GCP + 5 CASE_APPLICATION, reusing the same 5 real, already-approved
Gate 16 case studies the Gate 17 tranche used) against the real, registered
ICH E6(R3) source - 6/6 succeeded, all `READY_FOR_REVIEW` (the two
candidates that had previously hit the Gate 17 citation false-positive now
pass cleanly, confirming the Gate 20 fix on real data). Report:
`data/imports/observations/reports/gate18-real-tranche-report.json`.

## 17. What Gate 18 does NOT implement

No embeddings, no vector database, no semantic search, no mass question
generation (the real tranche is capped at 6 items), no automatic
publication, no exam/certificate logic changes, and no second AI provider,
question bank, or grounding architecture. Gate 19 was not started.
