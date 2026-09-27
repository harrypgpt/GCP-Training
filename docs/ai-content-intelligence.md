# AI Content Intelligence Foundation (Stage 6B)

## What this is — and what it is not

This stage adds an AI-assisted **authoring aid** for the content team. It is not the
examination engine, not certificate generation, and it never publishes a question.

> **AI generates CANDIDATE CONTENT. A human reviewer controls publication. The
> Stage 6 Question Bank remains the single, authoritative source of truth for
> everything a learner can ever be examined on.**

Concretely:

- AI output is always persisted as an `AiQuestionCandidate` — a row in a table
  that is entirely separate from `Question` / `QuestionVersion`. A candidate is
  never shown to a learner and is never eligible for an exam.
- The only way a candidate's content reaches the real question bank is a single,
  explicit conversion call that reuses the exact `QuestionsService.create()`
  method a human author's `POST /admin/questions` call uses. There is no second,
  AI-specific write path into `Question` / `QuestionVersion`.
- A converted question always lands as a **DRAFT**, version 1. It then goes
  through the same SUBMIT_FOR_REVIEW → APPROVE → PUBLISH workflow (Stage 4/6)
  as any human-authored question. Converting never sets `currentPublishedVersionId`.
- Nothing here modifies an existing APPROVED or PUBLISHED `QuestionVersion`.

## Architecture overview

```
apps/api/src/modules/ai/
├── ai.module.ts                        NestJS module wiring
├── ai-generation.service.ts            orchestrates generate/* operations
├── ai-candidates.service.ts            list/get/accept/reject
├── ai-candidate-conversion.service.ts  the ONLY path into the real question bank
├── controllers/
│   ├── ai-generation.controller.ts     POST /admin/ai/generate/*, GET /admin/ai/runs*
│   └── ai-candidates.controller.ts     /admin/ai/question-candidates*
├── interfaces/                         AiProvider, request/response, error types
├── providers/
│   ├── provider.factory.ts             picks a provider from config
│   ├── mock.provider.ts                deterministic, offline, default
│   └── openai.provider.ts              real OpenAI Chat Completions client
├── prompts/                            versioned prompt templates (one per operation)
├── grounding/                          builds the bounded evidence context; enforces privacy
├── validation/                         zod output schemas + the deterministic quality checklist
├── policies/                           AI_ENABLED / external-provider policy gates
└── dto/                                request/response DTOs
```

### Provider abstraction

Every provider implements one interface:

```ts
interface AiProvider {
  readonly name: string;
  complete(request: AiProviderRequest): Promise<AiProviderResponse>;
}
```

`AiProviderFactory.getProvider()` reads `AI_PROVIDER` from config and returns the
matching implementation. No business logic anywhere else in the module touches a
vendor SDK, an API key, or a vendor-specific response shape — everything downstream
of the factory only ever sees `AiProviderRequest` / `AiProviderResponse`. Adding a
new vendor (Anthropic, Google, Azure, a self-hosted model) means adding one new
`AiProvider` implementation and one `case` in the factory; nothing else changes.

`AiProviderFactory.isExternalProvider(name)` returns `false` only for `'mock'` —
every other provider is treated as "external" for privacy-boundary purposes (see
below), regardless of whether it happens to be self-hosted.

### The mock provider — why it exists and what it proves

`MockAiProvider` (`name: 'mock'`) is deterministic and makes no network call. It is
the default (`AI_PROVIDER=mock`) so the whole feature — generation, validation,
grounding, provenance, candidate lifecycle, failure handling, audit logging — is
fully testable without a paid API key. It builds structurally valid output per
operation from the grounding context it's given (e.g. it echoes the learning
objective and source label into the generated stem so tests can assert the
grounding context genuinely reached the "model").

It also honors a test-only hook, `context.simulate`, with five values:
`'timeout' | 'unavailable' | 'refused' | 'malformed' | 'insufficient_evidence'` —
each exercises a distinct failure path (see **Failure handling** below). Real
providers simply ignore this field if a caller happens to send it; production
code never sets it.

**The mock provider is never used to fake a successful production call.** It is a
test/offline substitute selected explicitly via `AI_PROVIDER=mock`, not a fallback
silently substituted when a real provider fails.

### The OpenAI provider

`OpenAiProvider` calls the real Chat Completions API over `fetch`, with:

- an `AbortController`-driven timeout (`AI_TIMEOUT_MS`),
- HTTP status mapping to `AiProviderError`: 429/5xx → transient
  `PROVIDER_UNAVAILABLE`; other 4xx → non-transient `PROVIDER_REFUSED`;
  an aborted request → `PROVIDER_TIMEOUT`.

**Disclosed limitation:** this provider has been written and typechecked but has
never been exercised against the live OpenAI API in this environment (no network
egress in this test setup, and `OPENAI_API_KEY` is intentionally not configured).
All generation/validation/lifecycle testing in this stage uses the mock provider.
Before using `AI_PROVIDER=openai` in a real environment, run it manually against a
real key and confirm the response mapping once.

## Configuration

All AI configuration lives server-side; nothing is ever exposed to the frontend.

| Variable                      | Purpose                                                  | Default   |
| ----------------------------- | -------------------------------------------------------- | --------- |
| `AI_ENABLED`                  | Master kill switch — every AI endpoint 503s when false   | `true`    |
| `AI_PROVIDER`                 | `mock` \| `openai`                                       | `mock`    |
| `AI_MODEL`                    | Model identifier passed to the provider                  | `mock-v1` |
| `AI_MAX_TOKENS`               | Max tokens per request                                   | `2000`    |
| `AI_TEMPERATURE`              | Sampling temperature                                     | `0.2`     |
| `AI_TIMEOUT_MS`               | Per-request timeout                                      | `30000`   |
| `AI_EXTERNAL_CONTENT_ALLOWED` | Global switch: may an _external_ provider be used at all | `false`   |
| `AI_MAX_RETRIES`              | Bounded retry count for transient provider failures      | `2`       |
| `OPENAI_API_KEY`              | Required only when `AI_PROVIDER=openai`                  | —         |

Env validation (`env.schema.ts`) fails the app at boot if `AI_PROVIDER=openai` and
no `OPENAI_API_KEY` is set — the same fail-fast pattern used for every other
required config in this project.

## Grounding: the bounded evidence package

`GroundingService.buildContext(params, { isExternalProvider })` fetches (in
parallel, by ID — never free text) the real rows referenced by a generation
request: `Source` / source section, `CaseStudy`, `Observation`, `LearningObjective`,
`TrainingLevel`, `Module`, `ProfessionalRole`, `GcpDomain`. It assembles them into a
`GroundingContext`, which is what the prompt templates render into the actual model
prompt (`prompts/prompt-types.ts#contextSection`). The AI is instructed to use only
this supplied evidence, never invent a citation or section number, distinguish
practical/observational experience from regulatory requirement, and flag
insufficient evidence rather than guess.

`GROUNDING_VERSION` (`'v1'`) is persisted on every `AiGenerationRun` so that a
future change to what "grounding" means is traceable against historical runs.

### Privacy boundary — two independent gates

1. **Global policy gate** (`AiPolicyService.ensureProviderAllowed`): if the
   selected provider is external and `AI_EXTERNAL_CONTENT_ALLOWED=false`, every
   external-provider call is refused (`EXTERNAL_CONTENT_BLOCKED`, 403) — regardless
   of what any individual content record says.
2. **Per-content gate** (`GroundingService`, only evaluated once a provider _is_
   external): `CaseStudy` and `Observation` each carry an
   `externalAiEligibility` column — `INTERNAL_ONLY` (the default, conservative)
   or `SAFE_FOR_EXTERNAL_AI`. Building a grounding context for an external
   provider throws `EXTERNAL_CONTENT_BLOCKED` if the referenced case study or
   observation is not explicitly marked `SAFE_FOR_EXTERNAL_AI`.

There is no automatic de-identification or anonymization. Marking content as safe
for an external provider is an explicit, human decision by whoever authored it —
the system never infers or fakes it.

## Structured output & deterministic quality validation

Provider output is never trusted as free text. It is parsed as JSON, then validated
against a zod schema (`validation/ai-output.schemas.ts`,
`AI_OUTPUT_SCHEMA_VERSION = 'v1'`) covering all 12 Stage 6 question types and all
four difficulty levels (EASY/MEDIUM/HARD/EXPERT — never inferred from wording
length). Only after schema validation passes does
`validateAiQuestionOutput()` (`validation/ai-output.validator.ts`) run — a
**deterministic**, non-AI-trusted checklist, not the model's own self-report:

1. Stem present
2. Question type is a recognised value
3. Difficulty is a recognised value
4. At least two answer options
5. No option has empty text
6. Option IDs are unique
7. `correctOptionId` references an existing option
8. An explanation is present
9. A rationale is present for higher-order types (SCENARIO, CASE_STUDY,
   REASONING, REGULATORY_INTERPRETATION, INVESTIGATOR/CRA/SPONSOR_DECISION,
   RISK_PRIORITIZATION, EVIDENCE_ASSESSMENT)
10. Grounded in a source/case study/observation, or explicitly flagged as
    insufficient-evidence
11. `REGULATORY_INTERPRETATION` questions require an authoritative source
12. `CASE_STUDY` questions require case-study provenance
13. Output is structurally well-formed (guaranteed upstream by zod parsing)
14. No duplicate option text
15. The correct answer's text does not leak verbatim into the stem/instructions
16. No unsupported regulatory citation (a citation-shaped phrase — "21 CFR",
    "ICH E6", "FDA", "EMA", "IRB/IEC guideline" — without a grounded source)
17. No invented evidence reference (every claimed evidence label is checked
    against what was actually supplied as grounding)
18. Provenance is recorded overall (source, case study, observation, or at
    minimum a learning objective)

Any failed check is an **error** and blocks the candidate at `VALIDATION_FAILED` —
it can never reach `READY_FOR_REVIEW`. Everything else (missing-but-flagged
grounding, the model's own self-reported warnings, an evidence claim that doesn't
match supplied context) is a **warning**: surfaced, never blocking.

### Quality signals are not a confidence score

`deriveQualitySignals()` produces informational indicators —
`evidenceCoverage`, `regulatoryGrounding`, `caseGrounding`, `reasoningDepth`,
`insufficientEvidenceFlagged`, `provenanceCompleteness`, and similar — stored
alongside the quality report and shown in the admin UI clearly labelled as
"informational indicators, not a confidence score." Nothing in this stage produces
a single numeric "AI confidence" and treats it as ground truth.

## Candidate lifecycle

```
GENERATED → VALIDATION_FAILED           (blocking errors found; dead end)
GENERATED → READY_FOR_REVIEW            (validation passed)
READY_FOR_REVIEW / IN_REVIEW → ACCEPTED (reviewer decision)
READY_FOR_REVIEW / IN_REVIEW → REJECTED (reviewer decision, reason required)
ACCEPTED → (converted)                  one-way, exactly once
```

`AiCandidatesService.accept()` / `.reject()` only permit the transition from
`READY_FOR_REVIEW` or `IN_REVIEW`; anything else is a 409
`INVALID_CANDIDATE_TRANSITION`. Rejecting requires a reason (min 3 characters),
recorded on the candidate and in the audit log.

**Accepting a candidate is not publishing it.** `ACCEPTED` only means a reviewer
judged the content sound; the question bank is untouched until conversion runs.

### Conversion — the single, guarded path into the question bank

`AiCandidateConversionService.convert(candidateId, actorId)`:

1. Requires `status === 'ACCEPTED'` (409 otherwise).
2. Requires the candidate has not already been converted
   (`convertedQuestionId` must be null — 409 `CANDIDATE_ALREADY_CONVERTED`
   otherwise; conversion is one-way and exactly-once).
3. Builds a `CreateQuestionDto` from the candidate's stored fields and calls
   `QuestionsService.create(dto, actorId)` — **the same method a human author's
   `POST /admin/questions` call uses.** This is the whole safety guarantee: there
   is no parallel/duplicate write path, so AI cannot create a question through any
   route a human's request wouldn't also have to go through.
4. Records `convertedQuestionId` / `convertedQuestionVersionId` / `convertedAt`
   on the candidate, and writes an `AI_CANDIDATE_CONVERTED` audit entry.

`actorId` is the caller (the reviewer who clicks "convert"), so the resulting
draft's authorship correctly reflects who brought it into the question bank — not
the AI, and not necessarily the original author of the generation request. This
was verified live: a converted question lands as DRAFT v1 with
`currentPublishedVersionId: null`, authored by the converting user, and must go
through the normal review workflow like any other draft.

## Source traceability

Every `AiGenerationRun` and every `AiQuestionCandidate` records: the operation,
provider, model, initiating user, prompt template version, grounding version,
output schema version, and every grounding reference supplied (source id, source
section, case study id, observation id, learning objective id, level/module/role
id), plus token usage and latency where the provider reports them. A candidate
additionally links its case-study provenance through a proper many-to-many join
table (`AiQuestionCandidateCaseStudy`), since a case-study-grounded question may
legitimately draw on more than one case.

## Authorization

Reuses the existing role model — no new roles were introduced:

| Role             | Can                                                                   |
| ---------------- | --------------------------------------------------------------------- |
| `CONTENT_AUTHOR` | Generate (concepts/objectives/questions); view runs and candidates    |
| `REVIEWER`       | Everything above, plus accept/reject/convert candidates               |
| `ADMIN`          | Everything above                                                      |
| `LEARNER`        | Nothing — every `/admin/ai/**` route 403s (verified in the e2e suite) |

There is no learner-facing AI surface anywhere in this stage: no chat, no tutor, no
generative content in the exam interface (which doesn't exist yet regardless).

## Audit logging

Six new `AuditAction` values, all append-only via the existing `AuditService`:
`AI_GENERATION_REQUESTED`, `AI_GENERATION_SUCCEEDED`, `AI_GENERATION_FAILED`,
`AI_CANDIDATE_ACCEPTED`, `AI_CANDIDATE_REJECTED`, `AI_CANDIDATE_CONVERTED`. Every
entry records who acted, what operation, the grounding IDs supplied, provider and
model, prompt/schema versions, and the resulting status/candidate id. No entry ever
stores a raw API key or secret.

## Failure handling

Handled explicitly, each with its own outcome and (for the provider layer) an
`AiProviderErrorCode`:

| Condition                                       | Behaviour                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| Timeout                                         | `PROVIDER_TIMEOUT`, transient → retried, then `TIMED_OUT` run status  |
| Rate limit / 5xx                                | `PROVIDER_UNAVAILABLE`, transient → retried                           |
| Refused (other 4xx / content policy)            | `PROVIDER_REFUSED`, **not** retried                                   |
| Malformed / invalid JSON                        | caught after the provider call, run `FAILED`, no candidate created    |
| Schema validation failure                       | run `FAILED`, no candidate created                                    |
| Missing grounding for external content          | `EXTERNAL_CONTENT_BLOCKED`, request rejected before any provider call |
| Business validation failure (quality checklist) | candidate persists as `VALIDATION_FAILED`, not retried                |

A provider failure or malformed response **never** corrupts question-bank data and
never creates a `QuestionVersion` — the failure is contained entirely within
`AiGenerationRun` / `AiQuestionCandidate`.

### Retry policy

`callWithRetry` retries only when `AiProviderError.transient === true`, up to
`AI_MAX_RETRIES` (configurable, default 2). `PROVIDER_REFUSED` and business
validation failures are never retried — retrying a non-transient failure would
just reproduce the same refusal or the same invalid output.

## Frontend (admin-only)

- **`/admin/ai`** — generation workspace: pick grounding context (level, domain,
  role, learning objective, source + section, case study, observation), then
  either extract concepts, generate learning objectives, or generate a question
  candidate (type, difficulty, optional variant label e.g. "CRA perspective").
  Carries a persistent banner: AI output is always candidate content; nothing is
  ever published automatically.
- **`/admin/ai/runs`** — paginated `AiGenerationRun` list, filterable by
  operation/status, showing provider/model, grounding, initiator, latency.
- **`/admin/ai/question-candidates`** — paginated candidate list, filterable by
  status.
- **`/admin/ai/question-candidates/:id`** — candidate detail: stem, options,
  explanation/rationale, the full deterministic quality report (errors/warnings/
  checklist) and quality signals, and the provenance/traceability panel (every
  grounding link plus provider/model/prompt/grounding/schema versions). Reviewer
  actions (accept / reject-with-reason / convert) are gated client-side to
  REVIEWER/ADMIN — the API re-checks the same roles on every request regardless.
  The conversion action's own copy states explicitly: **"Creates a DRAFT question
  in the existing question bank"** — it never implies publication, and the page
  shows a link straight to the resulting draft's Stage 6 admin page afterward.

## Known limitations / explicit extension points

- **OpenAI provider untested against a live network.** Written and typechecked,
  but this environment has no configured API key or network egress for a real
  call. Verify manually before relying on it in production.
- **`prompts/quality-review.prompt.ts` exists but is not wired to an endpoint.**
  `AiOperation.QUALITY_REVIEW` is a defined enum value and the prompt template is
  ready; no controller route or service method calls it yet. This is a disclosed,
  intentional placeholder for a future review-assistance feature.
- **No semantic duplicate detection.** Per the Stage 6B spec, this was explicitly
  out of scope. `AiOperation.DUPLICATE_ANALYSIS` exists as an enum value and an
  extension point, but the AI module does not call into Stage 6's existing
  mechanical duplicate-flagging infrastructure for candidates. A future stage
  could add embedding-based similarity search; nothing here claims to provide it.
- **No exam integration.** The exam engine does not exist yet; this stage does
  not touch it and does not generate exam-time content.
- **Quality signals are informational only** — they inform a reviewer, not an
  automated accept/reject decision.

## No false claims

To be explicit, consistent with the Stage 6B mandate: nothing in this system
claims that an AI-generated question is automatically correct, guarantees
regulatory compliance, guarantees the absence of hallucination, or guarantees a
question is non-duplicate. Every one of those judgments remains a human reviewer's
responsibility, exercised through the existing Stage 6 review workflow.
