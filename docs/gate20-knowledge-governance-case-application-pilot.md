# Knowledge Governance & Real-Gemini CASE_APPLICATION Pilot (Gate 20)

## 1. Objective

Prove the real Gemini CASE_APPLICATION pathway end-to-end (Gate 19 only
proved DIRECT_GCP for real), on a small, human-governed, capped pilot
tranche - and, in the process, build the ONE piece of governance
infrastructure that was missing to make that pathway ever reachable with a
genuinely external AI provider: a controlled, per-item, human-approval
mechanism for external-AI eligibility (Gate 20 §8). This gate adds no new
grounding, validation, question schema, provider, or question-generation
category - it is a governance and validation gate on top of Gates 10-19's
completely unmodified architecture.

## 2. Architecture inspected (Gates 10-19, reused unchanged)

`Observation`/`ObservationVersion`/`ObservationTrainingInterpretation`/
`ObservationSourceLinkReview`, `CaseStudy`/`CaseStudyVersion`/
`CaseStudySpecification`, `AiGenerationRun`/`AiQuestionCandidate`,
`Source`/`SourceVersion`/`SourceSection`, `GroundingService`,
`CaseStudyGenerationService`, `CaseStudyQuestionGenerationService`,
`AiCandidatesService`, `AiCandidateConversionService`,
`validateAiQuestionOutput`, `validateQuestionGovernance`, `GeminiProvider`,
`AiProviderFactory`, `AppConfigService`, `AiPolicyService`, `AuditService`,
`WORKFLOW_ACTION_ROLES`/RBAC. Every one of these is used exactly as Gate
15-19 left it - none was modified except `ai-output.validator.ts` and
`question-duplicates.service.ts`, which each had ONE private helper function
exported (never changed) so Gate 20's new code could reuse it instead of
re-implementing it.

## 3. Real database baseline (read BEFORE any Gate 20 mutation)

| Metric                                                                             | Value                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Observation                                                                        | 1,834                                                                                                                                                                   |
| ObservationVersion                                                                 | 1,834                                                                                                                                                                   |
| Curated (CURATED/APPROVED) ObservationVersion                                      | 155                                                                                                                                                                     |
| APPROVED-status curated ObservationVersion                                         | 0 (curation stops at CURATED in this dataset - an existing, pre-Gate-20 fact, not a blocker: the grounding service accepts CURATED or APPROVED)                         |
| SAFE_FOR_EXTERNAL_AI (version or observation)                                      | 0                                                                                                                                                                       |
| APPROVED_FOR_EXTERNAL_AI (de-identification)                                       | 0                                                                                                                                                                       |
| CaseStudy / CaseStudyVersion                                                       | 50 / 50                                                                                                                                                                 |
| APPROVED/PUBLISHED CaseStudyVersion                                                | 48                                                                                                                                                                      |
| AiGenerationRun                                                                    | 67                                                                                                                                                                      |
| AiQuestionCandidate                                                                | 14                                                                                                                                                                      |
| Question / QuestionVersion / Exam / ExamAttempt / Certificate                      | 0 / 0 / 0 / 0 / 0                                                                                                                                                       |
| By evidence class                                                                  | INSPECTION_EVIDENCE: 35, PRACTICAL_EXPERIENCE: 1,799                                                                                                                    |
| By observation type                                                                | AUDIT_OBSERVATION: 557, CLINICAL_OPERATIONS_OBSERVATION: 1,242, FDA_WARNING_LETTER_OBSERVATION: 35 (FDA_483_OBSERVATION and PROPRIETARY_OBSERVATION: 0 real rows exist) |
| Fully eligible (curated + APPROVED interpretation + APPROVED/PUBLISHED case study) | 48, spanning 20 distinct real GCP domains                                                                                                                               |
| APPROVED training interpretations                                                  | 50                                                                                                                                                                      |

These numbers were read directly from the database, not assumed.

## 4. Why a new governance mechanism was required

Gates 15-19 never actually exercised the external-AI eligibility gate
against a genuinely external provider with real data, because Gate 17-19's
own real tranches happened to succeed at the pre-flight check stage against
mock-provider calls (`isExternalProvider('mock') === false` skips the check
entirely) or, in Gate 19, failed closed exactly as designed when a real
external call was attempted (0/5 CASE_APPLICATION). Inspecting the codebase
confirmed `Observation.externalAiEligibility` /
`ObservationVersion.externalAiEligibility` /
`ObservationVersion.deIdentificationStatus` had **no mutation path
anywhere** - not even a generic admin update endpoint could reach them (the
generic `updateVersion()` requires the version still be in an editable
DRAFT-ish state, which curated/approved records no longer are, by design).
`AuditAction.OBSERVATION_AI_ELIGIBILITY_CHANGED` already existed in the
shared enum (defined in an earlier gate) but had never been wired to
anything - a clear, deliberate placeholder for exactly this gate.

## 5. The new mechanism (Gate 20 §8)

`ObservationExternalAiEligibilityService.decide()` +
`PATCH /api/admin/observation-versions/:id/external-ai-eligibility`
(`apps/api/src/modules/admin/observations/observation-external-ai-eligibility.service.ts`).
Role-gated to `REVIEWER`/`ADMIN` only (the same roles the generic content
workflow already reserves for `APPROVE`). Requires:

- decision `APPROVE` or `REVOKE`,
- a mandatory `reason` (`@MinLength(10)`, an empty or trivial reason is
  rejected at the DTO layer),
- for `APPROVE` only: the ObservationVersion's `curationStatus` must already
  be `CURATED`/`APPROVED`, AND at least one linked
  `ObservationTrainingInterpretation` must already be `APPROVED` - a 409 with
  a new, specific error code
  (`NOT_READY_FOR_EXTERNAL_AI_ELIGIBILITY_DECISION`) otherwise.

On approval it sets, in one transaction: `ObservationVersion.
externalAiEligibility = SAFE_FOR_EXTERNAL_AI`,
`ObservationVersion.deIdentificationStatus = APPROVED_FOR_EXTERNAL_AI`, and
`Observation.externalAiEligibility = SAFE_FOR_EXTERNAL_AI` - and records a
full audit event (`AuditAction.OBSERVATION_AI_ELIGIBILITY_CHANGED`) with
`observationVersionId`, `reviewerId`, `decision`, `reason`, `previousState`,
`newState`, via the existing, unmodified `AuditService`. `REVOKE` is
symmetric (sets both back to `INTERNAL_ONLY`, downgrades a
prior-`APPROVED_FOR_EXTERNAL_AI` de-identification status back to
`DE_IDENTIFIED`).

**There is no bulk/batch variant of this endpoint, by design.** It operates
on exactly one ObservationVersion per call. No script, migration, or seed
job in this gate ever mass-updates these fields - the only writes come from
14 individual, differently-reasoned calls (§8 below).

## 6. Human-governed pilot-tranche approval (never automated)

`apps/api/scripts/approve-gate20-pilot-tranche.ts` calls
`ObservationExternalAiEligibilityService.decide()` once per item, for 14
real, already-curated observations, each with its own specific,
domain-tied rationale (not a generic loop message) - see the script for the
exact text. Selection criteria (documented, not regex/source-type/AI-driven):
direct inspection of the 48 fully-eligible real records for GCP-domain
diversity, deliberately choosing FDA Warning Letter, real (non-FDA)
clinical-operations, and real audit-observation records across 10 distinct
GCP domains (Data Integrity, Protocol Compliance, Informed Consent, Vendor
Oversight, Audit Trails & Access, Clinical Data Management, Subject Safety,
Source Documentation, Computerised System Validation, Computerized Systems,
Ethics Oversight, Training/Qualification, Bioanalytical Operations x2).
Acting reviewer: the real `gate16-reviewer@gcp-training.local` REVIEWER
account. Enforced by `Gate20VolumeGuard.reserveSelection()`
(cap 20) - 14/14 approved on the first run.

**Bioanalytical Operations**: exactly 2 real, curated, eligible records
exist in this domain - both were included (§6's "cover several categories"
requirement, honestly limited by what real data actually exists).
**Expert observation** (`PROPRIETARY_OBSERVATION`): **NOT AVAILABLE** -
confirmed zero such records exist anywhere in the real curated bank
(re-confirming Gate 18's known limitation); none was fabricated.

## 7. Volume guard (Gate 20 §5/§24)

`Gate20VolumeGuard`
(`apps/api/src/modules/admin/case-study-generation/gate20-volume-guard.ts`):
four independent, in-process counters -
`reserveSelection()`/`reserveGeneration()`/`reserveRealGeminiCall()`/`reserveRetry()`

- capped at `MAX_GATE20_SELECTED=20`, `MAX_GATE20_GENERATED=20`,
  `MAX_GATE20_REAL_GEMINI_CALLS=20`, `MAX_GATE20_RETRY_CALLS=5`. A rejected
  reservation never mutates its counter, so it cannot be bypassed by catching
  and retrying. 8 unit tests prove per-counter caps, that 100 repeated retry
  attempts past a cap all fail, and - specifically addressing §24's "100 API
  requests -> 100 Gemini calls must be impossible" - that 100 **concurrent**
  (`Promise.all`) reservation attempts against a cap of 20 still yield exactly
  20 successes and 80 rejections, with the final counter never exceeding 20.

## 8. Gemini integration and prompt architecture (reused unchanged)

The pilot used the SAME real Gemini model verified working in Gate 19
(`gemini-3.5-flash-lite`, discovered via the live `/v1beta/models` endpoint,
since hard-coding a model name is explicitly unsafe - Gemini deprecates
model names without notice). The SAME, completely unmodified
`buildCaseApplicationQuestionPrompt()` (Gate 18) already renders the exact
two-block structure Gate 20 §9 asks for -
`[NORMATIVE GCP SOURCE]`/`[CASE STUDY EVIDENCE]` - with the exact required
policy language ("The case-study evidence describes a scenario... Determine
the applicable GCP principle from the supplied ICH E6(R3) source.").
No new prompt file was created.

## 9. Validation (existing + new additive layer)

`validateAiQuestionOutput` and `validateQuestionGovernance` run unmodified
on every real candidate exactly as before. **New, additive only**:
`validateCaseApplicationQuestionQuality()`
(`gate20-question-quality-validator.ts`) adds three checks the existing two
validators do not cover, and never overrides `candidateStatus`:

- **B. Evidence fidelity** (WARNING) - does the model's self-reported
  evidence actually reference the supplied scenario, not just the normative
  section?
- **E. Per-option unsupported-claim scan** (ERROR) - the existing citation
  check (§18 of `ai-output.validator.ts`) only scans stem/explanation/
  rationale; this applies the exact same citation/record-identifier logic
  (reused via export, not reimplemented) to every individual answer option,
  so a citation smuggled into a distractor is never missed.
- **F. Single-best-answer / ambiguous-distractor proxy** (WARNING) - flags a
  distractor whose normalized word-overlap with the correct option exceeds
  70%, a deterministic, documented heuristic for
  `MULTIPLE_PLAUSIBLE_CORRECT`, never a semantic-equivalence claim and never
  a weighted "quality score".

Checks A/C/D/G (normative alignment, correct-answer support, stem-level
unsupported-claim detection, citation-vs-record-identifier
disambiguation) are the EXISTING validators' job and are deliberately not
re-implemented. 8 unit tests cover all three new checks plus the
"evidenceUsed unavailable" fallback path (see §14).

## 10. Reviewer checklist (Gate 20 §18)

Reused the EXISTING candidate review UI/workflow
(`AiCandidatesService`/`AiCandidateConversionService`,
`AiQualityReport`/`AiTraceabilityPanel` components) - no second review
system was built. The 11-point checklist the governing instruction lists
(ICH alignment, scenario fidelity, correct answer, distractor quality, no
unsupported claim, no fabricated regulation, clear wording, single best
answer, appropriate difficulty, educational usefulness, traceability) maps
directly onto what the existing panel already surfaces per candidate
(`qualityReport.checks`, the new Gate 20 quality signals recorded in the
pilot report, and the full traceability fields Gate 18 already added to the
UI) - a human reviewer works through this checklist using the existing
screen. No new UI was required.

## 11. Traceability

Confirmed by direct, read-only database query for a real pilot candidate
(`f7c18898-e0fe-488b-8bae-8956aa35e03c`): `Observation
(OBS-FDA-WL-652067) -> ObservationVersion -> ObservationTrainingInterpretation
(APPROVED) -> CaseStudySpecification -> CaseStudyVersion (APPROVED) ->
AiGenerationRun (provider=gemini, model=gemini-3.5-flash-lite,
promptTemplateVersion=case-study-question-generation-v3) ->
AiQuestionCandidate (questionGenerationType=CASE_APPLICATION,
normativeSource=ICH_E6_R3, normativeSourceVersion=PUBLISHED E6(R3),
normativeSourceSection=4.3.3, scenarioSourceType=FDA_WARNING_LETTER,
status=READY_FOR_REVIEW, reviewerId=null, convertedQuestionId=null)`. All 14
pilot candidates carry the equivalent full chain (see the JSON report).

## 12. Duplicate detection (Gate 20 §22)

`apps/api/scripts/gate20-duplicate-check.ts` reuses
`QuestionDuplicatesService.normalizeStem`/`normalizeOptionSet` (exported for
this purpose, not reimplemented) to compare all 14 real candidates against
each other and against every other non-DISCARDED `AiQuestionCandidate` and
non-ARCHIVED `QuestionVersion` in the database. **Result: 0 exact-stem or
exact-option-set duplicates found.** No embeddings/semantic similarity used
(explicitly out of scope). Findings recorded in the report's
`duplicateAnalysis` section, not written to the `QuestionDuplicateFlag`
table (that table's FK schema is scoped to converted `QuestionVersion`
pairs; these are pre-conversion candidates).

## 13. Security

`GEMINI_API_KEY` was read exclusively through `AppConfigService`; a
repo-wide grep for the literal key value found zero matches outside this
conversation. `AI_PROVIDER=gemini`/`AI_MODEL`/`AI_EXTERNAL_CONTENT_ALLOWED`
were activated only via shell-level environment variables for individual
script invocations - `.env` was never edited (dotenv's default
non-override behavior, the same established pattern from Gate 19).

## 14. Real pilot results

**14/14 CASE_APPLICATION generations succeeded on the first attempt** (no
retries were needed; `Gate20VolumeGuard.reserveRetry()` was never called).
All 14 candidates: `READY_FOR_REVIEW`, exactly 1 correct option among 4,
zero Gate 20 quality errors, zero `MULTIPLE_PLAUSIBLE_CORRECT` warnings.
**One consistent, honest, non-blocking finding**: all 14 candidates carry
the EXISTING (`validateAiQuestionOutput` §19)
"claimed evidence reference(s) could not be matched to the supplied
grounding content" WARNING - the real model's self-reported `evidenceUsed`
strings are paraphrased rather than exact substrings of the grounding
labels, so the existing fuzzy substring-match heuristic under-matches them
even though the actual regulatory grounding is correct (manually confirmed:
explanation text correctly cites the right ICH E6(R3) section content in
every reviewed case). This is a genuine finding about the EXISTING check's
precision against real (non-deterministic) model phrasing, not a governance
or normative-purity failure - it is recorded honestly, not hidden, and was
**not** "fixed" in this gate (fixing it would mean tuning an existing Gate
17 validator, out of Gate 20's stated scope).

## 15. Human review

Not performed as part of this gate. All 14 real candidates remain
`READY_FOR_REVIEW`, `reviewerId: null`, `convertedQuestionId: null`. No
script in this gate calls accept/reject/convert. **Do not claim human
review occurred - it has not**, per the governing instruction's explicit
requirement.

## 16. Database integrity (before -> after, this gate only)

| Table                                    | Before    | After     | Delta                                                  |
| ---------------------------------------- | --------- | --------- | ------------------------------------------------------ |
| Observation                              | 1,834     | 1,834     | 0                                                      |
| ObservationVersion                       | 1,834     | 1,834     | 0                                                      |
| SAFE_FOR_EXTERNAL_AI ObservationVersions | 0         | 14        | **+14** (the deliberate, human-approved pilot tranche) |
| CaseStudy / CaseStudyVersion             | 50 / 50   | 50 / 50   | 0 / 0                                                  |
| AiGenerationRun                          | 67        | 81        | **+14**                                                |
| AiQuestionCandidate                      | 14        | 28        | **+14**                                                |
| Question / QuestionVersion               | 0 / 0     | 0 / 0     | 0 / 0                                                  |
| Exam / ExamAttempt / Certificate         | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0                                              |

No unexpected table changed; no observation/case-study CONTENT was
modified (only the eligibility labels on the 14 deliberately-approved
records).

## 17. Regression

`pnpm format:check` / `pnpm lint` / `pnpm typecheck`: all green.
`pnpm test`: API 47 suites / 629 tests, Web 40 files / 209 tests - all
green under serial execution (`--runInBand`); under default PARALLEL
workers, `password.service.spec.ts` (pre-existing, untouched by Gate 20)
intermittently exceeded Jest's 5s per-test timeout due to argon2's CPU cost
competing with many parallel workers on this machine - reproduced twice,
resolved by running serially, and confirmed NOT a real regression (the same
file passes 6/6 reliably in isolation). `pnpm build`: both apps succeed.
`pnpm --filter @gcp/api test:e2e`: 23 suites / 354 tests, all green under
serial execution. `pnpm prisma migrate status`: up to date, 30 migrations
(unchanged from before this gate - Gate 20 required zero schema changes).
Manually inspected all migration files: only non-destructive `DROP NOT
NULL`/`DROP CONSTRAINT` statements exist anywhere (pre-Gate-15, unrelated to
this gate); no `DROP TABLE`, `DELETE FROM`, or `TRUNCATE` anywhere in the
repository's migration history.

## 18. Limitations

1. Curation in this real dataset stops at `CURATED`, never reaches
   `APPROVED` - a pre-existing fact (confirmed again in this gate's
   baseline), not a Gate 20 issue; the grounding service already accepts
   either.
2. Expert observation (`PROPRIETARY_OBSERVATION`) evidence remains
   unavailable in the real curated bank (still 0 rows) - re-confirmed, not
   newly discovered.
3. The existing evidence-fidelity fuzzy-match heuristic under-matches a
   real model's paraphrased self-reported citations (§14) - a precision gap
   in existing Gate 17 code, documented but not modified in this gate.
4. Token/cost metadata remains unavailable per generation (same limitation
   as Gate 19 - `GeminiProvider`'s response is not persisted onto
   `AiGenerationRun`).
5. A pre-existing CPU-contention test flake in `password.service.spec.ts`
   under parallel Jest workers (§17) - unrelated to, and not introduced by,
   Gate 20.

## 19. Conclusion

The real Gemini CASE_APPLICATION pathway is now validated end-to-end with
real data, real curation/interpretation/case-study approvals, a real
external provider, and a real, deliberate, individually-reasoned human
governance decision unlocking exactly 14 real observations for that
purpose - never a mass approval, never an AI self-approval, never a
bypass of curation. `DIRECT_GCP` was not touched. No exam, certificate, or
learner-curriculum logic was touched. No question was published. Gate 20 is
complete; do not proceed to Gate 21 without explicit instruction.
