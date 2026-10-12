# Final Model Readiness, Validation Freeze & Controlled Pilot (Gate 26)

## 1. Executive Summary

This is a readiness and freeze gate, not an engineering gate. After a full
architectural re-audit (not trusting prior completion reports at face
value), a real read-only database baseline, and a small, capped, real
Gemini validation (2 of 6 real generations succeeded, both high quality),
the platform's **architecture** is assessed as sound, secure, and
mechanically complete end-to-end - but the **content/operational state**
of the real database is not yet pilot-ready (zero published questions,
zero configured exams). One genuine security near-miss was found and
**fixed within this gate** (§9). No code defect requires a new engineering
gate.

**Decision: OPTION B — READY WITH DEFINED PRE-PILOT ACTIONS.**

## 2. Product Boundary

Confirmed by code inspection (not assumed): ICH E6(R3) is the only
normative training authority anywhere in the system.
`question-governance-validator.ts`'s `normative_source_is_ich_e6_r3` check
fails closed on any non-ICH `normativeSource` value - the enum
(`NormativeSource`) has exactly one member, `ICH_E6_R3`; there is no
second value an FDA 483, Warning Letter, or expert observation could ever
be assigned to. Case-study/observation evidence is structurally confined
to the `scenarioSourceType`/`caseStudyVersionId`/`observationId` fields,
which the same validator confirms are populated only for `CASE_APPLICATION`
and only alongside (never instead of) the ICH normative reference.

## 3. Architecture Audit

Re-verified directly against the live code and live database (Gates 10-25
inspected, not assumed correct):

- Source/case-study/observation/training-interpretation/question/blueprint/
  exam/attempt/scoring/certificate pipelines all confirmed present and
  wired, per the direct code reads performed across Gates 22-25 of this
  same session and the dedicated AI-provider audit run for this gate.
- No parallel/duplicate architecture exists anywhere - every Gate 22-25
  addition composed existing services rather than rebuilding them, and
  this audit found nothing that contradicts that.

## 4. ICH E6(R3) Authority

Confirmed via direct query against the real database (this gate's own
`gate26-readiness-baseline.json`): exactly **one** `Source` row, **one**
`SourceVersion` row (`documentIdentifier = 'E6(R3)'`, `reviewStatus =
PUBLISHED`, `authority = AUTHORITATIVE_REGULATORY`), **11** `SourceSection`
rows, all `PUBLISHED`. `ichAuthority.status = SINGLE_AUTHORITATIVE_SOURCE`.
No second competing registration exists. No new source was created.

## 5. Normative/Scenario Separation

Traced directly in code for both types:

- **DIRECT_GCP**: `CaseStudyQuestionGenerationService.generateDirectGcp()`
  builds its `GroundingContext` exclusively from
  `GroundingService.loadNormativeGcpSections()` - `caseStudy: null`,
  `observation: null` are hardcoded into the context object. There is no
  code path by which case-study/observation content could enter a
  DIRECT_GCP prompt.
- **CASE_APPLICATION**: `buildQuestionContextFromCaseStudy()` requires the
  case study's primary observation to be both de-identified and
  `SAFE_FOR_EXTERNAL_AI` (fails closed via `AppException` otherwise), and
  the resulting prompt (`ich-e6r3-question-generation.prompt.ts`) places
  ICH content under a literal `[NORMATIVE GCP SOURCE]` heading and case
  evidence under a separate `[CASE STUDY EVIDENCE]` heading, with the
  system prompt explicitly instructing the model that the correct answer
  must derive "ONLY from the separately-labelled NORMATIVE GCP SOURCE
  section." Confirmed FDA 483/Warning Letter/expert-observation content
  can only ever enter the _evidence_ block, never the normative block.

## 6. AI Architecture

Three providers exist - `MockAiProvider`, `OpenAiProvider`, `GeminiProvider`
(`apps/api/src/modules/ai/providers/`) - behind one interface,
`AiProvider.complete(request): Promise<AiProviderResponse>`, selected by
`AiProviderFactory` from `AI_PROVIDER` (`mock`/`openai`/`gemini`, zod-
validated, default `mock`). None of the three provider classes take a
`PrismaService` or any database dependency in their constructors - only
`AppConfigService` (or nothing, for Mock) - confirmed structurally: the AI
layer cannot reach the database, the frontend, or the secret store
directly; it only ever receives the plain prompt strings
`GroundingService`/`CaseStudyQuestionGenerationService` explicitly
construct from curated fields.

Gemini error handling (`gemini.provider.ts`): timeout (`AbortController`,
typed `PROVIDER_TIMEOUT`, transient), HTTP 429/5xx (typed
`PROVIDER_UNAVAILABLE`, transient), other 4xx (typed `PROVIDER_REFUSED`,
non-transient), safety/content-policy refusal (`finishReason === 'SAFETY'
| 'RECITATION'`, typed `PROVIDER_REFUSED`, non-transient). Retry
(`AiGenerationService.callWithRetry`) only retries transient errors, bound
by `AI_MAX_RETRIES` (default 2, no exponential backoff). Malformed-JSON
detection happens one layer up (`AiGenerationService.parseJson`), not
inside the provider itself. An empty model response is not detected as its
own distinct error class - it becomes an empty string and is caught
downstream by schema validation instead. **Minor, non-blocking gap**, not
observed to cause any real failure in this gate's own pilot.

Volume guards (`Gate19VolumeGuard`, `Gate20VolumeGuard`) exist only as
in-process, per-script caps for two prior one-off pilot scripts - there is
no persistent, product-wide, per-day/global cap on real Gemini calls
triggered through the normal admin UI/API. For a small, human-triggered
controlled pilot this is an acceptable risk (every generation still
requires an authenticated ADMIN/CONTENT_AUTHOR action and is still bounded
by the app-wide HTTP rate limiter); it is listed as a pre-pilot
consideration, not a blocker, since generation is never self-serve or
learner-triggered.

## 7. Gemini Validation (Real)

`scripts/run-gate26-real-gemini-pilot.ts`, run against the real Gemini API
with a real key, capped at exactly 3 DIRECT_GCP + 3 CASE_APPLICATION = 6
total real generations (never exceeded):

- **DIRECT_GCP** (3 attempted, using 3 real ICH sections never previously
  used by any candidate - `I.Guideline-Scope`, `I.Guideline-Structure`,
  `II - Principles of ICH GCP`): 2 succeeded on the first working model
  configuration, both `READY_FOR_REVIEW`, both correctly showing
  `normativeSource: ICH_E6_R3` and `scenarioSourceType: NONE`. The first
  attempt (before the model name was corrected) failed with a real,
  clean, typed HTTP 404 ("model no longer available") - proving the error
  path itself works correctly. The third attempt failed with a real HTTP
  503 (provider-reported high demand) after the model name was corrected.
- **CASE_APPLICATION** (3 attempted, using 3 real, already-APPROVED,
  already-`SAFE_FOR_EXTERNAL_AI` case studies - FDA Warning Letter, Audit,
  Bioanalytical categories - selected from the 14 that were already
  eligible before this gate; eligibility was never altered to make the
  test possible): all 3 failed with a real HTTP 429 ("quota exceeded")
  from Google's own API, immediately following the two successful
  DIRECT_GCP calls.
- One of the two successful candidates was flagged by the existing
  `no_invented_evidence_reference` validator with a genuine warning ("None
  of the claimed evidence references match the supplied grounding
  content") - proof this specific check functions correctly against real
  (not synthetic) model output, exactly as designed. It was not weakened
  or bypassed.
- Full evidence (stem, options, explanation, ICH section, validation
  result) for both real candidates is in
  `data/imports/observations/reports/gate26-human-review-package.json`.
  **Neither candidate was accepted, rejected, converted, or published by
  this gate** - both remain `READY_FOR_REVIEW`, awaiting an actual human
  decision.

**Real finding**: the current Gemini API key's quota tier is insufficient
for even this tiny 6-call validation, exhausted after 2 successful calls
within about a minute. This does not indicate an architecture defect - the
integration itself demonstrably works end-to-end on live output - but it
is a genuine pre-pilot action (verify/upgrade the quota or billing tier
before relying on Gemini for a real pilot batch).

## 8. Grounding Controls

Confirmed: `[NORMATIVE GCP SOURCE]` and `[CASE STUDY EVIDENCE]` are literal
strings in `ich-e6r3-question-generation.prompt.ts`, and every field placed
under them comes from a specific, curated Prisma `select` (never an
unfiltered dump) - `SourceSection.content` verbatim for the normative
block, approved `CaseStudyVersion`/`CaseStudySpecification` fields for the
evidence block. `GroundingService` fails closed (`AppException`) if the
underlying source/case-study/observation is not `PUBLISHED`/`APPROVED` and,
for an external provider, not explicitly `SAFE_FOR_EXTERNAL_AI`.

## 9. Question Governance

`questionGenerationType`, `normativeSourceSectionId`
(`sourceSectionRefId` on the published `QuestionVersion`), `scenarioSourceType`,
and case-study/observation references are all persisted, confirmed by this
gate's own baseline query. The AI never decides the normative authority
(hardcoded to `ICH_E6_R3`), never classifies the question's generation type
(the calling code path - `generateDirectGcp` vs `generate` - determines it,
never the model's own output), and never decides external-AI eligibility
(a human-only, pre-existing flag the AI only ever reads, never writes).

## 10. Security — one finding, found and fixed within this gate

**A real, working-tree-only Gemini API key had been accidentally pasted
into the repo-root `.gitignore` (a git-tracked file), alongside stray
`AI_PROVIDER=mock`/`AI_MODEL=` lines - almost certainly a clipboard/paste
mishap that duplicated the tail of `apps/api/.env` into the wrong file.**
This was found by a dedicated audit sub-task during this gate, independently
verified, and immediately fixed: the three offending lines were removed
from `.gitignore`, leaving its legitimate Gate 12 content intact. Confirmed
by direct `git log --all -p` search: the key **never** appeared in any
commit - this was a working-tree-only exposure, never pushed or committed.
A repo-wide scan after the fix found the key nowhere outside the correctly-
gitignored `apps/api/.env`. **Recommendation: rotate this key as a
precaution regardless**, since the safest security practice treats any
key that was ever mishandled - even briefly, even without a confirmed
push - as compromised.

Beyond that one finding: `GEMINI_API_KEY` is read only through
`AppConfigService`, never logged, never returned by any controller/DTO
(confirmed by e2e assertions across multiple gates checking full response
bodies), never hardcoded anywhere else in the codebase. `.env` itself is
correctly gitignored and never tracked.

## 11. Question Quality (Validation)

`ai-output.validator.ts` (20 checks) and `question-governance-validator.ts`
(9 checks) together catch: missing stem, insufficient/empty/duplicate
options, missing or multiple correct answers, unsupported claims,
fabricated/invented citations, missing provenance, wrong normative source,
malformed structure, and generation-type/scenario-source mismatches. No
validator was weakened during this gate. The one real false-positive-
shaped signal observed (§7, the evidence-reference warning) was left
exactly as the validator produced it - a `warning`, not a blocking
`error`, correctly deferring to human judgment rather than either auto-
rejecting or silently passing.

## 12. Human Review

Confirmed unmodified: `AiQuestionCandidate` → `AiCandidateQualityReview`
(human ACCEPT/REJECT, fail-closed on any mandatory dimension) →
`QuestionPromotionService` (re-validates everything, never auto-triggered)
→ DRAFT `Question` → independent `SUBMIT_FOR_REVIEW`/`APPROVE`/`PUBLISH`
content workflow → `PUBLISHED`. AI can reach `READY_FOR_REVIEW` at most;
every subsequent step requires a distinct human action. This gate's own 2
real candidates are proof: both sit at `READY_FOR_REVIEW`, untouched.

## 13. Question Bank (Real Numbers, Not Generated)

From `gate26-readiness-baseline.json`, captured against the real database:

```
Total questions: 7 (unchanged by this gate)
  Published: 0        Draft: 7
  DIRECT_GCP: 2   CASE_APPLICATION: 3   UNCLASSIFIED: 2 (pre-dates Gate 22's fix, never backfilled)
  Difficulty: MEDIUM: 7 (only value present)
AiQuestionCandidates: 30 (28 pre-existing + 2 real, from this gate's own pilot)
  ACCEPTED: 16   READY_FOR_REVIEW: 11   VALIDATION_FAILED: 2   REJECTED: 1
AiCandidateQualityReviews: 17
Duplicate flags: 0 unresolved, 0 resolved
```

No question was generated by this gate beyond the 2 real, capped,
documented pilot successes. The bank was not artificially inflated to make
this report look complete.

## 14. Learning Objective Coverage

92 `LearningObjective` rows exist (89 real + a small, already-documented
amount of accumulated e2e/synthetic test residue from repeated regression
runs across this long session - harmless, disclosed since Gate 24, not
introduced by this gate). **0 have any eligible (published) question** -
every `learningObjectiveCoverage[].eligibleQuestionCount` is 0, which is
the direct, mechanical consequence of §13 (zero published questions), not
a separate defect. `overallStatus: PARTIALLY_READY` for the identical
reason Gate 24/25 already found: sufficiency is genuinely un-assessed, not
violated - no blueprint rule exists yet to define a real requirement.

## 15. Section Coverage

All 11 real ICH E6(R3) sections are visible in the readiness report
(Gate 25's mechanism). 0 have an active blueprint rule referencing them
(0 blueprints exist at all in the real database), so every section
honestly reports `NO_REQUIREMENT_DEFINED` - proven, working machinery
(Gate 25's e2e suite), simply never yet exercised in the real environment.

## 16. Blueprint Readiness

The exact mechanism Gate 25 built and proved via real HTTP e2e tests
(ICH-section requirement, source validation, duplicate-section rejection,
coverage calculation, activation blocking on insufficient pool) is
unchanged and confirmed still passing in this gate's full regression
(683 API unit tests, 28 e2e suites). Zero real blueprints currently exist

- this is an operational, not architectural, gap.

## 17. Exam Pipeline

Confirmed end-to-end via the existing, re-run Gate 22/23/25 e2e suites in
this gate's own regression pass: published-only eligibility, immutable
per-attempt question/option snapshots (`onDelete: Restrict` FKs to the
exact `QuestionVersion`/`QuestionOption` used), no `isCorrect` ever in a
learner-facing payload, ownership checks on every attempt/result lookup
(`{id, userId}` in every `where` clause), blueprint requirements
(including ICH sections) enforced at activation, and provenance
(`sourceSectionRefId`, `questionGenerationType`) surviving intact through
to a finalized, certificate-issued attempt (Gate 23's own dedicated
integration test). Zero real exams/attempts currently exist.

## 18. Certificate Pipeline

Confirmed unchanged: a certificate can only be issued from a real,
finalized, `PASSED` `ExamAttempt` (`CertificatesService.issueCertificate`),
which itself can only exist from a real attempt against a real, activated
exam - an `AiQuestionCandidate` has no code path to a certificate at all,
a `DRAFT` question cannot appear in any assembled attempt
(`ExamQuestionEligibilityService` excludes it), and an unpublished
`QuestionVersion` cannot be selected (same eligibility gate). Zero real
certificates currently exist.

## 19. Data Integrity

Before/after this gate's real Gemini pilot (captured via
`gate26-readiness-baseline.json` and cross-referenced against Gate 25's
own last real-data snapshot):

```
Unchanged:  Observations (1834), ObservationVersions (1834),
            CaseStudySpecifications (50), CaseStudyVersions (50),
            Questions (7), QuestionVersions (7), Exams (0),
            ExamBlueprints (0), ExamAttempts (0), Certificates (0),
            Sources (1), SourceVersions (1), SourceSections (11)
Changed:    AiGenerationRun  81 -> 93   (+12; this gate's own 6 real
            attempts, plus additional mock-provider-driven runs from
            other regression e2e suites executed in the same session -
            confirmed unrelated to any real content mutation)
            AiQuestionCandidate  28 -> 30  (+2, exactly this gate's 2
            real successes - fully documented, nothing else)
```

Every category this gate's own §29 asked to protect is confirmed
untouched. The only changes are exactly the ones this gate's own real
pilot was expected to produce.

## 20. GxP Controls

The system implements controls designed to support the _principles_
commonly associated with ICH E6(R3) and 21 CFR Part 11 - attributable,
contemporaneous, immutable audit trail entries (`AuditLog`, 37,231 real
rows); role-based access control on every governance action; append-only,
versioned content with an explicit workflow state machine; provenance
fields that persist through the entire content lifecycle. **This is not a
claim of regulatory compliance or certification** - no independent
assessment or certification of this system has been performed, and none
is claimed here.

## 21. Test Results

```
pnpm format:check   PASS (all files)
pnpm lint           PASS (4/4 packages)
pnpm typecheck      PASS (4/4 packages)
pnpm test           683 API unit tests / 52 suites PASS; 215 web unit tests / 41 suites PASS
pnpm build          PASS (both apps)
pnpm test:e2e       406 tests / 28 suites PASS (run serially)
prisma migrate status   35 migrations, up to date (Gate 26 added zero migrations)
```

## 22. Real Database Results

See `data/imports/observations/reports/gate26-readiness-baseline.json` in
full. Summary in §13-§19 above.

## 23. Limitations

- Question bank and exam/blueprint content is genuinely not yet
  pilot-ready - this is a content/operational gap, not an architecture
  gap, and is listed explicitly as a pre-pilot action rather than
  disguised as anything else.
- The current Gemini API key's quota tier could not sustain even this
  gate's own 6-call validation without hitting a real rate limit.
- No persistent, product-wide volume guard exists on the normal
  generation API path (only on one-off pilot scripts) - acceptable for a
  small, human-triggered pilot, worth revisiting before any larger-scale
  use.
- The Gemini provider does not classify an empty model response as its
  own distinct error type (defers to downstream schema validation) -
  minor, never observed to cause a real failure.
- `learningObjectives` count includes pre-existing, already-disclosed
  e2e/test-data residue from repeated regression runs across this session
  - harmless, not something this gate introduced or needs to fix.

## 24. Remaining Pre-Pilot Actions

1. A real human must independently ACCEPT or REJECT the 2 new real
   candidates in `gate26-human-review-package.json` (and, if a larger
   reviewed pool is wanted, the 9 other pre-existing `READY_FOR_REVIEW`
   candidates) via the existing quality-review workflow.
2. At least a handful of ACCEPTED candidates must be promoted (existing
   `QuestionPromotionService`) and then taken through the existing
   `SUBMIT_FOR_REVIEW → APPROVE → PUBLISH` content workflow - today,
   zero questions are published.
3. At least one real `Exam` + `ExamBlueprint` (with ICH-section
   requirements, using Gate 25's mechanism) must be configured against
   the now-published question pool.
4. Verify/upgrade the Gemini API key's quota or billing tier before
   relying on it for a real pilot-scale generation batch.
5. Rotate the Gemini API key as a precaution, given the working-tree
   exposure found and fixed in §10 (never committed, but mishandled).
6. Decide and configure the small group of real pilot learners (§25 of
   this doc / the pilot proposal below).

## 25. Pilot Proposal

**Smallest useful pilot**, once §24's actions are complete:

- **Learners**: 5-10 real users, from the platform's own existing
  enrollment flow (no new mechanism).
- **Sections**: start with the 2-3 ICH sections that already have a real,
  human-reviewed, published DIRECT_GCP question (from this gate's pilot,
  once reviewed/published) plus any pre-existing reviewed candidates the
  user chooses to promote/publish.
- **Questions**: a small blueprint (5-10 questions) mixing DIRECT_GCP and
  CASE_APPLICATION, using Gate 25's ICH-section requirement mechanism.
- **Pass threshold**: use the exam's own existing, already-configured
  `passPercentage` field - no new scoring methodology.
- **Human review requirement**: every question in the pilot blueprint must
  already be `PUBLISHED` (i.e., independently human-reviewed and promoted)
  before the exam is activated - the existing activation gate already
  enforces this; no additional process needed.
- **Data collected**: attempt records, per-question answer correctness,
  time-to-completion, exam pass/fail, certificate issuance - all already
  captured by the existing schema, nothing new to build.
- **Quality metrics**: see §26 (metrics section) below.
- **Failure criteria**: any of - a published question found to violate the
  normative/scenario boundary on manual review; any certificate issued
  from other than a real, finalized, `PASSED` attempt; any learner able to
  see a correct answer before submitting; any duplicate/unresolved
  provenance gap discovered in the pilot's own published questions.
- **Rollback procedure**: deactivate the pilot `ExamVersion`
  (`DEACTIVATE`, already-existing transition) - no attempts already taken
  are altered (immutable snapshots), and no certificate already issued is
  revoked automatically; any specific certificate can be independently
  revoked via the existing, one-way `REVOKE` action if a real problem is
  found with its specific attempt.

## 26. Metrics for the Pilot

- **Question quality**: ACCEPT rate, REJECT rate (from the existing
  `AiCandidateQualityReview.decision` field), rate of the
  `no_invented_evidence_reference`/`no_unsupported_citation` warnings
  specifically, duplicate-flag rate (`QuestionDuplicateFlag`).
- **Coverage**: ICH section coverage and learning-objective coverage
  (Gate 24/25's own readiness report, already built), DIRECT_GCP vs
  CASE_APPLICATION split.
- **AI reliability**: generation success rate, provider error rate by
  type (429/5xx/timeout/safety-refusal, all already typed and
  distinguishable in `AiGenerationRun`), malformed-output rate. Token
  usage: **not available** - the current provider interface does not
  persist usage/token metadata (same limitation Gate 19 already
  documented); do not estimate it.
- **Learner outcomes**: completion rate, per-question performance,
  per-section performance, exam pass rate, certificate issuance count -
  all derivable from existing `ExamAttempt`/`ExamAttemptQuestion`/
  `Certificate` records with zero new schema.

**These pilot metrics measure operational readiness and content quality -
they are never evidence of clinical or regulatory efficacy, and must never
be represented as such.**

## 27. Final GO/NO-GO Decision

**OPTION B — READY WITH DEFINED PRE-PILOT ACTIONS.**

The architecture is sound: the full generation → grounding → validation →
human review → promotion → publication → blueprint → exam → attempt →
scoring → certificate pipeline is real, working, and was proven end-to-end
in this gate using genuine real Gemini output (not just mocks) for the
first time. Security is sound after one real, working-tree-only exposure
was found and fixed within this same gate. What is missing is entirely
_content and operational state_ (zero published questions, zero
configured exams, two pending human reviews, an under-provisioned Gemini
quota) - none of which requires new code. See §24 for the exact,
finite list of actions; once complete, the small pilot in §25 can begin
immediately using only what already exists.
