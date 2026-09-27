# Controlled Real-Gemini Validation & Question Quality Pilot (Gate 19)

Gate 19 validates the Gate 17/18 AI question-generation pipeline against the
**real** Gemini API, on a small, capped, fully-traceable tranche. It adds no
new architecture: the exact same `GroundingService`,
`CaseStudyQuestionGenerationService`, `validateAiQuestionOutput`,
`validateQuestionGovernance`, `AiPolicyService`, and review/conversion
workflow from Gates 15-18 are reused completely unmodified. The only new code
is a volume guard, a revised connectivity-only smoke test, and one
orchestration script - never a second provider, schema, or category.

## 1. Did real Gemini work?

**Yes, for DIRECT_GCP. No, for CASE_APPLICATION - and the reason is a real,
pre-existing data-eligibility gate, not a bug.**

- **Smoke test** (`pnpm --filter @gcp/api gemini:smoke-test`, rewritten per
  §3 to make zero training-content calls and create zero database rows):
  auth, model resolution, JSON response, and JSON parsing were all confirmed
  working end-to-end against the real API.
- **DIRECT_GCP pilot**: 3/3 real generations succeeded, each producing a
  `READY_FOR_REVIEW` candidate with full, real, verifiable traceability to
  the registered ICH E6(R3) document.
- **CASE_APPLICATION pilot**: 0/5 real generations were attempted against
  the actual Gemini API. All 5 were correctly refused _before_ any provider
  call, by the pre-existing (Gate 15) external-AI eligibility check in
  `GroundingService` - see §6.

## 2. Attempt/pass/fail counts, and why

| Type             | Attempted | Succeeded | Validation-failed | Failed (pre-flight/provider)   |
| ---------------- | --------- | --------- | ----------------- | ------------------------------ |
| DIRECT_GCP       | 3         | 3         | 0                 | 0                              |
| CASE_APPLICATION | 5         | 0         | 0                 | 5 (`EXTERNAL_CONTENT_BLOCKED`) |
| **Total**        | **8**     | **3**     | **0**             | **5**                          |

All 8 attempts are well under the Gate 19 caps (20/20/40) - see §3.

During iterative development (before the prompt fix in §5 was applied), 3
additional real DIRECT_GCP calls were made and failed schema validation
(`MALFORMED_OUTPUT`, non-conforming `type`/`difficulty` casing). Those 3
attempts created `AiGenerationRun` rows (status `FAILED`) but no candidates,
and are visible in the before/after integrity counts (§13) as
`AiGenerationRun +6` against only `AiQuestionCandidate +3`. They are not
included in the "8 attempted" figure above, which reflects only the final,
reported pilot run; including them, the real total across this whole gate is
11 real Gemini API calls for generation, still far under the cap.

## 3. Volume cap enforcement

`Gate19VolumeGuard` (`apps/api/src/modules/admin/case-study-generation/gate19-volume-guard.ts`)
enforces `MAX_GATE19_DIRECT_GCP=20`, `MAX_GATE19_CASE_APPLICATION=20`,
`MAX_GATE19_TOTAL=40` in-process, before every real call - a rejected
reservation never mutates its counters, so it cannot be bypassed by
catching and retrying. 6 unit tests
(`gate19-volume-guard.spec.ts`) prove per-type and total caps are enforced
and cannot be exceeded even by 100 repeated retry attempts. The pilot script
used only 3 DIRECT*GCP + 5 CASE_APPLICATION = 8 reservations - nowhere near
the ceiling, a deliberate, conservative choice for a \_validation* pilot.

## 4. Unsupported claims

No real candidate in this pilot triggered `validateAiQuestionOutput`'s
unsupported-claim/citation checks (all 3 successful DIRECT_GCP candidates
passed both `validateAiQuestionOutput` and `validateQuestionGovernance`
cleanly). The EXISTING Gate 18 negative-test suite
(`ich-e6r3-question-governance.e2e-spec.ts`) already proves this check fires
correctly using the deterministic mock provider's `simulate:
'unsupported_claim'` path - re-verified passing in this gate's regression
(§14), not re-implemented.

## 5. A real bug this pilot found and fixed (prompt, not schema)

The Gate 18 prompt (`ich-e6r3-question-generation.prompt.ts`) told the model
`"type": string, "difficulty": string` without ever enumerating the exact
closed-vocabulary literal values `aiQuestionOutputSchema` requires
(`QuestionType`: `KNOWLEDGE`/`APPLICATION`/.../`EVIDENCE_ASSESSMENT`;
`DifficultyLevel`: `EASY`/`MEDIUM`/`HARD`/`EXPERT`). `MockAiProvider` always
fabricates exactly-compliant values, so this gap was invisible until a real,
non-deterministic model produced `"multiple_choice"`/`"MULTIPLE_CHOICE"`/
`"multiple-choice"` and `"medium"` - all correctly, strictly rejected by the
**unchanged** zod schema (`MALFORMED_OUTPUT`, fail-closed, no candidate
created).

The fix is a **prompt-wording change only** - the schema itself was never
touched or loosened:

- `OUTPUT_SHAPE` now spells out both closed-vocabulary lists verbatim.
- Each builder now explicitly instructs the model to set `"type"` to exactly
  `"REGULATORY_INTERPRETATION"` (DIRECT_GCP) or `"CASE_STUDY"`
  (CASE_APPLICATION), and `"difficulty"` to exactly the requested value,
  verbatim/case-sensitive.
- Prompt versions were bumped (`direct-gcp-question-generation-v1` -> `v2`;
  `case-study-question-generation-v2` -> `v3`) so every `AiGenerationRun`
  remains traceable to the exact prompt text that produced it.

After this fix, all 3 real DIRECT_GCP attempts succeeded on the first try.

## 6. Normative-purity incidents (FDA/observation treated as normative)

**None occurred, and none could occur in this pilot** - `GroundingService`
enforces this before any provider call for both types (unchanged from Gate
18, re-verified by this gate's regression). No FDA Warning Letter, 483, or
observation was ever sent as a normative source; the 5 CASE_APPLICATION
attempts were blocked entirely, so no scenario evidence reached a real model
at all in this pilot.

## 7. Traceability

All 3 real candidates are fully traceable end-to-end (verified by direct,
read-only database query, not fabricated):
`Source (ICH E6(R3)) -> SourceVersion (PUBLISHED) -> SourceSection ->
AiGenerationRun (provider=gemini, model=gemini-3.5-flash-lite,
promptTemplateVersion=direct-gcp-question-generation-v2) ->
AiQuestionCandidate (questionGenerationType=DIRECT_GCP,
normativeSource=ICH_E6_R3, scenarioSourceType=NONE, caseStudyVersionId=null,
observationId=null, status=READY_FOR_REVIEW, reviewerId=null,
convertedQuestionId=null)`. Example: candidate `6b38fa71-dddf-4ad4-b1a3-6003f1eed80d`,
grounded in Section II.1 (Rights, Safety and Well-Being), run
`874c5763-e787-4f34-b1df-d35cf07a3988`.

## 8. Human review bypassed?

No. All 3 real candidates are `READY_FOR_REVIEW` with `reviewerId: null`,
`convertedQuestionId: null`. No script in this gate calls `accept`, `reject`,
or `convert`.

## 9. Anything published?

No. `Question`/`QuestionVersion`/`Exam`/`ExamAttempt`/`Certificate` counts
are all `0` before and after this gate (§13).

## 10. Was an exam created?

No.

## 11. Was any observation/case-study data modified?

No. `Observation`, `ObservationVersion`, `TrainingInterpretation`,
`CaseStudy`, and `CaseStudyVersion` counts are byte-for-byte identical
before and after (§13). Per §16 of the governing instruction, this pilot
never edits curation/eligibility data - see §6/§12 below for why that
constraint is precisely what blocked the CASE_APPLICATION pilot.

## 12. Why CASE_APPLICATION could not be piloted against real Gemini here

`GroundingService.buildQuestionContextFromCaseStudy()` requires, for any
**external** provider, that the primary observation's `ObservationVersion`
AND its parent `Observation` both carry
`externalAiEligibility = SAFE_FOR_EXTERNAL_AI`, and the `ObservationVersion`
also carries `deIdentificationStatus = APPROVED_FOR_EXTERNAL_AI`. A direct,
read-only query of the full curated bank found **zero** real
`ObservationVersion` rows satisfying all three conditions - every real
observation in this environment defaults to `INTERNAL_ONLY`. This is a real,
structural finding, not a bug: no real CASE_APPLICATION candidate can be
generated by any genuinely external AI provider (Gemini or OpenAI) in this
environment until a human deliberately marks specific, reviewed observations
externally-eligible - and Gate 19 explicitly forbids this pilot from making
that editorial decision itself ("never modify observations/curation").
This is reported honestly rather than worked around; the mock-provider path
(which is not "external") continues to exercise the full CASE_APPLICATION
pipeline correctly, as proven by the Gate 17/18 real-tranche reports and
regression suite.

## 13. Real-data integrity (before -> after, this gate's pilot run only)

| Table                  | Before | After | Delta                                               |
| ---------------------- | ------ | ----- | --------------------------------------------------- |
| Observation            | 1834   | 1834  | 0                                                   |
| ObservationVersion     | 1834   | 1834  | 0                                                   |
| Source                 | 1      | 1     | 0                                                   |
| SourceVersion          | 1      | 1     | 0                                                   |
| SourceSection          | 11     | 11    | 0                                                   |
| TrainingInterpretation | 50     | 50    | 0                                                   |
| CaseStudy              | 50     | 50    | 0                                                   |
| CaseStudyVersion       | 50     | 50    | 0                                                   |
| AiGenerationRun        | 61     | 67    | **+6** (3 successful + 3 failed pre-fix, see §2/§5) |
| AiQuestionCandidate    | 11     | 14    | **+3** (the 3 successful DIRECT_GCP candidates)     |
| Question               | 0      | 0     | 0                                                   |
| QuestionVersion        | 0      | 0     | 0                                                   |
| Exam                   | 0      | 0     | 0                                                   |
| ExamAttempt            | 0      | 0     | 0                                                   |
| Certificate            | 0      | 0     | 0                                                   |

No unexpected table changed. The only new rows are exactly the AI
generation/candidate records this pilot intentionally created.

## 14. Regression

`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (API: 44
suites/606 tests; Web: 40 files/209 tests), `pnpm build` (both apps), and
`pnpm prisma migrate status` (no drift, 30 migrations, schema up to date) all
passed. `pnpm --filter @gcp/api test:e2e` passed **22/22 suites, 343/343
tests** when run serially (`--runInBand`); one file
(`ich-e6r3-question-governance.e2e-spec.ts`) failed a single count-based
assertion when run under Jest's default parallel workers, because another
concurrently-running e2e file wrote an `AiGenerationRun` row to the same
shared dev database between that test's own before/after count capture - a
pre-existing cross-file test-isolation race in this project's
shared-database e2e setup, not something Gate 19 introduced (Gate 19 did not
modify this test file). Re-running that file alone, and the full suite
serially, both passed deterministically. This is recorded as a known
limitation (§16), not silently ignored.

## 15. API usage (approximate)

- Smoke-test/model-discovery calls (no training content, no DB rows): ~7
  (model-name discovery against a live API whose currently-deprecated
  models are not published anywhere except at request time).
- Real question-generation calls: 3 successful + 3 failed-before-fix = 6
  DIRECT_GCP attempts; 0 CASE_APPLICATION attempts reached the provider
  (blocked pre-flight). Total generation-path real API calls: **6**.
- Token/cost metadata: the smoke test observed real `usageMetadata` (e.g.
  35 prompt + 5 completion tokens on one call), confirming the field
  exists on the wire, but `GeminiProvider`'s response is not persisted onto
  `AiGenerationRun.requestParams` by any existing code path. Per §19 of the
  governing instruction, the pilot report records this as
  `"NOT AVAILABLE (not persisted by the current provider interface)"`
  rather than estimating a cost silently.

## 16. Known limitations / what to correct before larger-scale generation

1. **CASE_APPLICATION cannot run against any real external provider today**
   - no real observation is marked `SAFE_FOR_EXTERNAL_AI` +
     `APPROVED_FOR_EXTERNAL_AI`. A future gate would need a deliberate,
     human-reviewed de-identification/eligibility pass over a subset of the
     curated bank before a real CASE_APPLICATION pilot is possible.
2. **Real Gemini model availability changes without notice** - two model
   names failed with HTTP 404 "no longer available" during this session,
   and the eventually-successful model was found by querying the live
   `/v1beta/models` endpoint, not from prior documentation. Any future
   real-Gemini usage should re-verify the model name the same way rather
   than assuming a previously-recorded one still resolves.
3. **A pre-existing prompt gap (§5) was only found because a real,
   non-deterministic model was used** - this is a general argument for
   periodic small real-provider pilots like this one, since the
   deterministic mock provider cannot surface this class of issue.
4. **A pre-existing e2e cross-file test-isolation race (§14)** exists in the
   shared-dev-database e2e setup; not introduced by, or in scope for, Gate
   19, but worth a dedicated fix in a future hardening pass.
5. Token/cost accounting is not currently persisted per generation (§15);
   would need a small, additive `AiGenerationRun` field if cost tracking
   becomes a real product requirement later.

## 17. Scope discipline

This gate did not: mass-generate, generate for all 1,834 observations,
publish any question, create an exam or attempt, modify certificate logic,
modify the learner training curriculum, add embeddings/vector search, add a
second AI provider architecture, add a third question-generation category,
or change any existing validator's semantics. The only schema change is
none - Gate 19 required zero migrations.
