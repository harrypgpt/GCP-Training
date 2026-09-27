# Gemini Provider Integration & Grounded AI Question Generation (Gate 17)

Gate 17 adds Google Gemini as a third, production-capable `AiProvider`
alongside the existing Mock and OpenAI providers, and adds the foundation for
generating single-best-answer question candidates grounded on approved
Gate 15/16 case-study knowledge. It changes nothing about how AI content
becomes authoritative: the AI is an authoring engine only, never a source of
truth, an eligibility engine, or a publishing authority.

## 1. Provider abstraction (unchanged, extended)

`AiProvider` (`interfaces/ai-provider.interface.ts`) is still the only seam:
`{ name: string; complete(request): Promise<response> }`. `GeminiProvider`
implements it exactly like `OpenAiProvider` - calling the vendor's REST API
with the platform's own `fetch` (no new SDK dependency), returning the same
normalized `{ text, usage?, latencyMs, model }` shape, and mapping HTTP
status/timeout/safety-refusal into the same `AiProviderError` codes
(`PROVIDER_UNAVAILABLE` / `PROVIDER_TIMEOUT` / `PROVIDER_REFUSED`). It never
imports Prisma, never sees a database credential, and never decides
eligibility, trustworthiness, or publication - it only turns a rendered
prompt into raw text.

`AiProviderFactory.getProvider()` now switches on `mock | openai | gemini`
and **fails fast** (throws `PROVIDER_UNAVAILABLE`) on any other value rather
than silently defaulting to the mock provider - Mock and OpenAI behavior is
unchanged.

## 2. Gemini configuration

Extends the existing zod-validated env schema
(`apps/api/src/config/env.schema.ts`) and `AppConfigService`
(`src/config/app-config.service.ts`) - the same architecture every other
provider and every other server-side secret already uses. No new config
system was introduced.

- `AI_PROVIDER` enum extended to `mock | openai | gemini` (was `mock | openai`).
- `GEMINI_API_KEY` (optional string) - required only when
  `AI_PROVIDER=gemini` (enforced by a `superRefine` rule mirroring the
  existing `OPENAI_API_KEY` rule exactly). Mock and OpenAI operation is
  completely unaffected by this key's presence or absence.
- `AI_MODEL` is reused unchanged (no new provider-specific model variable) -
  when `AI_PROVIDER=gemini`, set `AI_MODEL` to a real Gemini model name
  (e.g. `gemini-2.0-flash`).
- Exposed as `AppConfigService.ai.geminiApiKey` - providers never read
  `process.env` directly.
- `apps/api/.env.example` documents `GEMINI_API_KEY=` (commented out, no
  real value) exactly like the existing `OPENAI_API_KEY=` line. The real key
  belongs only in `apps/api/.env`, already covered by the repo's existing
  `.gitignore` rule (`.env` / `.env.*` / `!.env.example`) - no `.gitignore`
  change was needed.
- No frontend Gemini key of any kind exists - `NEXT_PUBLIC_GEMINI_API_KEY`
  was never created, and the key never appears in any API response.

## 3. Grounding boundary - Gemini never touches the database

`GroundingService` (reused, extended) resolves every reference server-side
and hands the provider only a bounded `GroundingContext` object - real IDs
and text, never a database handle, a query, or credentials. The flow is
always:

```
Backend eligibility/approval checks
        |
Approved grounding context (built server-side)
        |
AiProvider.complete() - Gemini/OpenAI/Mock, identical call shape
        |
Structured candidate output (zod-parsed)
        |
Deterministic backend validation
        |
Human review (mandatory)
```

Gemini/OpenAI/Mock are interchangeable at this seam precisely because none
of them ever see anything except the two rendered prompt strings and a
plain JSON `context` object used only by the Mock provider to fabricate
deterministic output.

## 4. Case-study-grounded question generation (new)

Gate 15 already grounds case-study _generation_ on curated knowledge;
Gate 16 curated a real tranche of that knowledge into approved
`CaseStudyVersion`s. Gate 17 closes the loop: it can now generate a
**question** grounded on one of those already-approved case studies,
without inventing a second question-authoring system.

Reused, unmodified end to end:

- `AiGenerationRun` / `AiQuestionCandidate` (the same tables the pre-existing
  `AiGenerationService.generateQuestions()` writes to).
- `aiQuestionOutputSchema` / `validateAiQuestionOutput` (the same structured
  output contract and deterministic validator).
- `AiCandidatesService.accept/reject` and `AiCandidateConversionService.convert`
  (the same human-review and DRAFT-question-creation workflow).

New, additive:

- `GroundingService.buildQuestionContextFromCaseStudy(caseStudyVersionId, opts)`
  - loads one `CaseStudyVersion`, requires `status` to be `APPROVED` or
    `PUBLISHED` (a `DRAFT`/`GENERATED`/`IN_REVIEW` version is refused with
    `GROUNDING_NOT_APPROVED`), re-verifies the linked training
    interpretation is `APPROVED` and the primary observation is still
    curated (defense in depth against later regression), and - for an
    external provider - re-applies the exact same
    `externalAiEligibility === SAFE_FOR_EXTERNAL_AI` +
    `deIdentificationStatus === APPROVED_FOR_EXTERNAL_AI` check Gate 15's
    case-study grounding already enforces. It returns a real
    `GroundingContext` (populating the existing `caseStudy`/`observation`/
    `learningObjective`/`domain`/`professionalRole` slots from the
    versioned data) plus the extra real IDs needed for traceability - so the
    existing prompt builder and validator are reused **completely
    unchanged**, never a second grounding shape.
- `CaseStudyQuestionGenerationService` (`admin/case-study-generation/`) - a
  separate service, following the exact precedent Gate 15's
  `CaseStudyGenerationService` already set ("a separate service because the
  eligibility/traceability concerns differ structurally, but never a second
  AI framework"). It owns its own `AiGenerationRun` creation, prompt
  rendering, retry/error-classification (mirroring
  `CaseStudyGenerationService`'s own private helpers line for line), and
  `AiQuestionCandidate` persistence - reusing the same
  `AiPolicyService`/`AiProviderFactory`/`AppConfigService` seam.
- `POST /api/admin/case-studies/:caseStudyId/versions/:versionId/generate-question`
  (`CONTENT_AUTHOR`/`ADMIN` only) - the one new endpoint.
- Two additive nullable columns:
  `AiGenerationRun.groundingCaseStudyVersionId` and
  `AiQuestionCandidate.caseStudyVersionId`, both FKs to `CaseStudyVersion`.
  Deliberately distinct from the existing `caseStudySpecificationId` column
  (which records what a `CASE_STUDY_GENERATION` run _produced_) - this one
  records what a `QUESTION_GENERATION` run _read_.

The question type is always `CASE_STUDY` (the existing pedagogical-shape
enum value, not a new one) - `validateAiQuestionOutput` already requires
case-study provenance for that type, so this path is validated at least as
strictly as any human-authored `CASE_STUDY` question. "Single-best-answer
MCQ" is not a new type: it is simply this platform's one existing answer
format (exactly one correct option out of N), which every question type
already uses.

## 5. Prompt versioning

`prompts/case-study-question-generation.prompt.ts` defines
`CASE_STUDY_QUESTION_GENERATION_PROMPT_VERSION = 'case-study-question-generation-v1'`,
recorded on every run's `promptTemplateVersion`. It reuses the shared
`GROUNDING_RULES` (now exported from `GroundingService`) and adds, verbatim,
the Gate 17-mandated instruction:

> If the supplied evidence does not support a claim, do not create that claim.

plus explicit instructions to: use only supplied evidence; never invent
citations, regulatory requirements, or clinical claims; produce exactly one
defensible correct answer and plausible distractors; explain the correct
answer from the supplied evidence; identify which evidence labels were
actually used; and set `insufficientEvidence: true` (rather than guessing)
when the evidence does not support a confident answer.

## 6. Structured output & deterministic validation

No new output schema was introduced - `aiQuestionOutputSchema` (zod) is
reused exactly: `type`, `difficulty`, `stem`, `options[]` (each with a
stable `id`), `correctOptionId` (exactly one, cross-checked against the
option list), `explanation`, `evidenceUsed[]`, `insufficientEvidence`.
Malformed JSON or a schema violation is rejected outright
(`MALFORMED_OUTPUT`), never repaired.

`learningObjectiveId`/`domainId` are deliberately **never** part of the
AI's own output schema - they come only from the server-resolved grounding
context, never from the model's self-report. Letting the model claim its
own classification would reopen exactly the "AI decides eligibility/
classification" boundary Gate 17 exists to keep closed.

`validateAiQuestionOutput` is reused unchanged, plus one real bug fix made
in this gate: previously, a **partially** fabricated `evidenceUsed` claim
(some real references mixed with one invented one) produced neither a
warning nor an error - only a _fully_ fabricated list was flagged. Gate 17
closes this gap: any invented reference now produces a warning at minimum
(`"N claimed evidence reference(s) could not be matched to the supplied
grounding content."`), so a partially-fabricated claim can never pass
silently. This is a general fix (benefits every question-generation path,
not only the case-study-grounded one) and is covered by a dedicated test.

## 7. Human review (fully reused)

Generated candidates enter the exact same review queue as every other
`AiQuestionCandidate`:

- `GET /api/admin/ai/question-candidates` / `/:id` (author/reviewer/admin).
- `POST /api/admin/ai/question-candidates/:id/accept` /
  `/reject` (reviewer/admin only) - the existing action vocabulary is
  ACCEPT/REJECT (there is no separate REQUEST_REVISION state in this
  pre-existing subsystem, unlike the `CaseStudyVersion` workflow; Gate 17
  deliberately did not invent one, per "do not bypass existing workflow" -
  REJECTED already serves the same "send back, do not use as-is" purpose).
- `POST /api/admin/ai/question-candidates/:id/convert-to-question` -
  creates a brand-new, DRAFT-only `Question`/`QuestionVersion` via the
  same `QuestionsService.create()` a human author's own
  `POST /admin/questions` call uses. **Accepting a candidate never
  publishes it** - conversion always lands as DRAFT, and only the
  pre-existing, unmodified `Question` workflow (`SUBMIT_FOR_REVIEW` ->
  `APPROVE` -> `PUBLISH`) can ever make it live. Proven end-to-end by e2e
  test.

A reviewer comparing LEFT/REFERENCE (the case study's source observation
text and approved training interpretation, via the specification the
candidate's `caseStudyVersionId` points to) against RIGHT/CANDIDATE (stem,
options, explanation, evidence references, validation report) can already
do so through the existing case-study version and candidate detail
endpoints; a dedicated side-by-side page (as Gate 16 built for case-study
review) was not built in this gate, since Gate 17's own scope list does not
require new UI - see Known Limitations.

## 8. Traceability

Every generated candidate is traceable through existing, real IDs, never a
parallel mechanism:

```
Observation -> ObservationVersion (curated: domain/role/risk/severity)
  -> ObservationTrainingInterpretation (APPROVED)
  -> CaseStudySpecification
  -> CaseStudyVersion (APPROVED/PUBLISHED)
  -> AiGenerationRun (groundingCaseStudyVersionId)
  -> AiQuestionCandidate (caseStudyVersionId, observationId)
  -> human reviewer (reviewerId/reviewedAt)
  -> converted Question/QuestionVersion (DRAFT, convertedQuestionId)
```

Proven by a dedicated e2e test that generates one real candidate and
asserts every one of these foreign keys resolves to the expected row.

## 9. External AI eligibility (fail closed)

Before any external provider (Gemini or OpenAI) is invoked,
`buildQuestionContextFromCaseStudy` requires the case study's primary
observation to be simultaneously `externalAiEligibility =
SAFE_FOR_EXTERNAL_AI` (on both the version and the legacy observation flag)
and `deIdentificationStatus = APPROVED_FOR_EXTERNAL_AI`. If not, the
request is rejected with `EXTERNAL_CONTENT_BLOCKED` **before** an
`AiGenerationRun` row is created and before the provider is ever called -
proven by both a unit test (`grounding.service.spec.ts`) and a full-pipeline
test (`case-study-question-generation.service.spec.ts`) that asserts the
provider's `complete()` method is never invoked.

## 10. Security

- `GEMINI_API_KEY` is read only via `AppConfigService.ai.geminiApiKey`,
  passed to Google only as a query parameter on the outbound request URL,
  and never appears in any `AiProviderResponse`, any API response, any log
  line, any audit record, or any test fixture (unit tests assert this
  explicitly with `JSON.stringify(response)`).
- `Question`/`QuestionVersion` never receive an unpublished-by-default
  status change purely from AI generation - only explicit human actions do.
- Generation requires `CONTENT_AUTHOR` or `ADMIN`; a bare `REVIEWER` and a
  `LEARNER` are both rejected (403); an unauthenticated request is rejected
  (401) - proven by e2e test.
- Review/accept/reject requires `REVIEWER`/`ADMIN`; a learner cannot even
  read a candidate (403) - proven by e2e test.
- `GeminiProvider` has no Prisma dependency at all - it cannot reach the
  database even by accident.

## 11. Database changes

Purely additive - two nullable UUID columns with `ON DELETE SET NULL`
foreign keys, two indexes, no new tables, no new enums, no dropped or
renamed columns:

```sql
ALTER TABLE "ai_generation_runs" ADD COLUMN "grounding_case_study_version_id" UUID;
ALTER TABLE "ai_question_candidates" ADD COLUMN "case_study_version_id" UUID;
-- + 2 indexes, + 2 foreign keys (both ON DELETE SET NULL)
```

No `Question`/`QuestionVersion`/`AiGenerationRun`/`AiQuestionCandidate` table
was duplicated; no second question bank or second AI run system exists.

## 12. Real-data tranche & Gemini smoke test

- `pnpm --filter @gcp/api gate17:real-tranche`
  (`apps/api/scripts/run-gate17-real-tranche.ts`) generates exactly five
  candidates from five deterministically-chosen, already-approved real
  Gate 16 `CaseStudyVersion`s (one FDA Warning Letter/patient-safety, one
  computerized-system, two other practical/expert observations across
  distinct domains, one PUBLISHED FDA/data-integrity item) and writes
  `data/imports/observations/reports/gate17-real-tranche-report.json`. It
  never accepts, rejects, converts, or publishes anything - human review is
  a separate, later step.
- `pnpm --filter @gcp/api gemini:smoke-test`
  (`apps/api/scripts/gemini-smoke-test.ts`) is opt-in and skips cleanly
  (exit 0, no error) unless `AI_PROVIDER=gemini` **and** `GEMINI_API_KEY`
  are both actually configured. It is never run by CI and the automated
  test suite never depends on it.

## 13. Known limitations

- **Citation-pattern false positive on real data**: the pre-existing
  `CITATION_PATTERN` regex (`\bFDA\b`, `21 CFR`, `ICH E\d`, ...) flags any
  question stem that contains one of those tokens without an authoritative
  `Source` supplied. Because Gate 16's real FDA-sourced observation codes
  are literally named e.g. `OBS-FDA-WL-729750`, and the mock provider's
  deterministic stem/case-study label includes that code, "FDA" appears as
  its own word (hyphen-delimited) and trips the check even though no actual
  unsupported regulatory _claim_ was made. Two of the five real-tranche
  candidates hit exactly this and landed at `VALIDATION_FAILED`. This is
  the deterministic validator correctly failing closed on a blunt
  heuristic, not a broken model or a broken pipeline - a human reviewer can
  see the flagged candidate and judge it a false positive. Refining the
  citation heuristic to distinguish an internal identifier from an actual
  regulatory claim is left to a future gate; weakening it now was
  deliberately avoided rather than risk a real false negative.
- **Single professional role only**: `buildQuestionContextFromCaseStudy`
  takes the first linked professional role when a specification has more
  than one (`GroundingContext.professionalRole` is singular, matching the
  pre-existing shape); multi-role case studies are not yet fully
  represented in the question's grounding context.
- **No dedicated side-by-side review page** was built for this specific
  pathway (Gate 17's own scope list does not require new UI); a reviewer
  currently inspects the case study version and the candidate through their
  existing, separate detail views/endpoints.
- **No real Gemini network call was exercised in this environment** (no
  `GEMINI_API_KEY` configured) - the entire pipeline, including the real
  five-item tranche, ran through the Mock provider, per Gate 17 §19's own
  requirement that the test suite and CI never depend on a live Gemini key.
  `GeminiProvider` itself is unit-tested against a mocked `fetch`, proving
  request construction, response parsing, and every error-classification
  path, but not a live third-party call.

## 14. What Gate 17 does NOT implement

Per its own explicit scope boundary: no embeddings, no vector database, no
semantic search, no adaptive learning, no learner-facing chatbot, no
automatic exam construction or scoring changes, no certificate changes, no
fine-tuning or custom model training, no autonomous publishing, no mass
question generation, and no automatic regulatory interpretation. Gate 18
was not started.
