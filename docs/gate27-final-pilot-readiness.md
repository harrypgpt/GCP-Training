# Gate 27 — Final Pilot Readiness, Controlled Question Bank Activation & Production Safety

**Status:** COMPLETE
**Decision:** `NOT_PILOT_READY`

This gate was the final engineering gate before a real pilot. It required proving
the complete real chain - published ICH E6(R3) content through a real blueprint,
exam, learner attempt, score, and certificate - using genuinely governed content,
never bypassing review, never mass-generating, and never fabricating provenance.
That chain is now proven, end to end, over real HTTP. It did not, however, reach
the ≥20-published-question minimum this gate requires, so the gate closes with a
disclosed shortfall rather than a false `PILOT_READY`.

## 1. Question bank activation (Phases 1-2)

11 real `AiQuestionCandidate` rows were reviewed and promoted through the exact
existing, unmodified governance workflow (`quality-review` → `promote` →
`SUBMIT_FOR_REVIEW` → `APPROVE` → `PUBLISH`, all real HTTP with real signed
JWTs for the real ADMIN/REVIEWER accounts):

- 2 genuine Gate 26 real-Gemini candidates were **ACCEPT**ed after full manual
  content review (one included independently re-verifying a disputed quote
  against the real `SourceSection` text - confirmed accurate, the validator's
  warning was a documented false positive).
- 9 candidates were **REJECT**ed with individually documented reasons: 1
  MockAiProvider fixed-placeholder stem, 5 templated candidates sharing an
  identical scenario-irrelevant "correct" answer (a real single-best-answer
  defect the deterministic validator cannot catch), 3 candidates with no
  normative grounding at all.
- 9 already-`ACCEPTED`-but-never-converted candidates from earlier gates were
  promoted with no new review needed.
- All 11 newly promoted + 7 pre-existing DRAFT questions were walked through
  the content workflow to `PUBLISHED`.

Result: **18 published questions** (4 `DIRECT_GCP`, 12 `CASE_APPLICATION`, 2
legacy `UNCLASSIFIED` pre-Gate-22 rows). 0 duplicate flags exist across any of
them (`QuestionDuplicateFlag` count = 0, confirmed by direct query and by the
real duplicate detector re-running on every `SUBMIT_FOR_REVIEW` this gate
triggered).

A small, explicitly capped (max 4) supplemental real-Gemini attempt was made to
close the gap toward 20. **0/4 succeeded** (1×503, 3×429) - Gemini quota is
confirmed still exhausted, an honest negative result, not retried further and
not bypassed.

## 2. Real pilot blueprint and exam (Phase 6)

Of the 18 published questions, 16 carry Gate 25's structured ICH E6(R3)
provenance (`sourceSectionRefId`) across 9 real, registered sections. All 16
had `levelId: null` (never previously targeted to a training level) -
`ExamQuestionEligibilityService` filters by level unconditionally, so each was
re-targeted to a new real pilot `TrainingLevel` via the real
`PATCH /admin/questions/:id` endpoint and walked back through the full
`SUBMIT_FOR_REVIEW → APPROVE → PUBLISH` workflow. This is a real, minimal,
governed content-management action (level targeting) - no question content,
provenance, or LO mapping was invented.

A real `TrainingProgram` → `TrainingLevel` → `Module` → `Lesson` was created
and published (genuine ICH E6(R3) orientation content, not filler). One real
`Exam` + `ExamVersion` was created via `POST /admin/exams`, and one real
`ExamBlueprint` with **9 rules** - one per real ICH E6(R3) section with an
eligible published question - was created via the existing, unmodified
`ExamBlueprintService`. Each rule's `exactCount` was sized at or below that
section's real eligible pool (13 required of 16 available, leaving headroom in
3 sections). `GET .../blueprint/validate` reported `valid: true`; the exam was
then `ACTIVATE`d (which itself re-runs blueprint validation and fails closed if
the pool is insufficient - confirmed directly when the exam correctly refused
to activate during the defect described in §4 below).

No second blueprint/exam architecture was created; `ExamBlueprintValidationService`,
`ExamBlueprintCoverageService`, and `ExamQuestionEligibilityService` were reused
exactly as they exist.

## 3. Real end-to-end pilot transaction (Phases 7-8)

A real learner account was created through the actual production auth flow, not
a shortcut: `POST /auth/register` → OTP captured from the real console mail
transport (the same plaintext a developer would see; never read from a
database column) → `POST /auth/verify-email` → `POST /auth/set-password` →
`POST /auth/login`. The learner then completed a real profile, a real
enrollment, and a real lesson (which cascaded to module and training
completion via the existing `ProgressService`/`TrainingStateComputer` - never a
direct completion flag).

The learner then:

1. `POST /learner/exams/:examId/start` → a real `ExamAttempt` selected 13
   questions purely from the blueprint-constrained real pool.
2. `GET .../attempts/:id/questions` → confirmed structurally that no
   `isCorrect`/answer-key field is ever present in the learner-facing payload.
3. Submitted real answers (resolved via direct DB lookup of each question's
   correct option - the only way to _script_ a passing attempt, since the
   learner API itself never exposes the key) via
   `POST .../attempts/:id/submit`.
4. `GET .../attempts/:id/result` → **PASSED, 100% (13/13), pass mark 70%.**
5. `POST /learner/certificates/issue` → a real `Certificate` was issued.
6. `GET /public/certificates/verify/:code` → publicly, unauthenticated,
   verified `valid: true`.

Every one of these steps was a real HTTP call against an ephemeral NestJS
server with a real signed JWT - never a direct service call, never a direct
DB status write, never seeding a question directly into the exam.

Direct-DB provenance verification confirmed, for every one of the 13 selected
questions: a valid `SourceSection` belonging to the registered, `PUBLISHED`,
`AUTHORITATIVE_REGULATORY` ICH E6(R3) source, and (for `CASE_APPLICATION`
questions) a real case-study evidence link. **3 of the 13** (all `DIRECT_GCP`)
have a valid section but no mapped Learning Objective - a genuine, disclosed,
pre-existing content-completeness gap (see §5), not fabricated to hide it.

## 4. A real defect, found and fixed

Activating the exam initially failed: every blueprint rule reported **0
eligible questions**, even though the 16 target questions had just been
correctly re-targeted and republished. Investigation traced this to a real bug
in `QuestionsService.update()`
(`apps/api/src/modules/admin/questions/questions.service.ts`): when a question's
latest version is not `DRAFT`, an update creates a new version by copying a
`fields` object that never included `sourceSectionRefId` or
`questionGenerationType` - so _any_ update to a published question (not just
the level-targeting update this gate needed) silently dropped both fields.

**Fix** (minimum scope): added both fields to `UpdateQuestionDto` (mirroring
`CreateQuestionDto`, which already exposed them) and to the `fields` object
using the same `dto.x ?? latest.x` fallback pattern already used for every
other field. Regression-tested: full suite green (below).

**Residual artifact:** the defect had already run once for real against the 16
target questions before being caught, leaving 12 superseded (non-current)
`QuestionVersion` rows with the dropped fields still `null`. These rows are
inert (only the current version matters to any eligibility/scoring/selection
logic), but one pre-existing regression test checks every historically
case-study-linked version and failed on them. There is no governed HTTP path to
edit a non-current version, so this was resolved via a direct, targeted Prisma
correction of the 2 known-correct columns on those 12 specific rows -
**explicitly approved by the user** after Claude Code's auto-mode classifier
first blocked the attempt as a direct shared-resource write. No review status,
content, or governance state was touched. The affected test and the full suite
were re-run afterward and are fully green.

## 5. Question bank readiness report

| Field                                                                         | Value                                          |
| ----------------------------------------------------------------------------- | ---------------------------------------------- |
| Total questions                                                               | 18                                             |
| Draft questions                                                               | 0                                              |
| Published questions                                                           | 18                                             |
| DIRECT_GCP                                                                    | 4                                              |
| CASE_APPLICATION                                                              | 12                                             |
| Unclassified (legacy)                                                         | 2                                              |
| Questions by ICH section                                                      | 9 real sections, 1-3 questions each (see JSON) |
| Questions with a mapped Learning Objective                                    | 13                                             |
| Questions missing a Learning Objective                                        | 5 (3 sectioned DIRECT_GCP + 2 unclassified)    |
| Duplicate flags (total / unresolved)                                          | 0 / 0                                          |
| Questions missing ICH provenance entirely                                     | 2                                              |
| Questions failing governance                                                  | 0                                              |
| Questions eligible for real exam use (structural)                             | 16                                             |
| Questions with complete DIRECT_GCP/CASE_APPLICATION provenance (section + LO) | 13                                             |
| Minimum required for pilot                                                    | 20                                             |
| Shortfall                                                                     | 2                                              |

No Learning Objective was invented for any question. This shortfall and the LO
gap are reported exactly as found.

## 6. Gemini production configuration (Phase 9)

`AI_PROVIDER=mock` / `AI_MODEL=mock-v1` / `AI_EXTERNAL_CONTENT_ALLOWED=false` in
the current, safe, checked-in-shape `.env` (the file itself is git-ignored and
was reverted to this state after every real-Gemini test this gate and Gate 26).
`GEMINI_API_KEY` is present only in that git-ignored file. Real connectivity
was exercised twice this gate/last gate: 2 real Gate 26 calls succeeded before
quota exhaustion; every one of 8 subsequent real calls across Gate 26's
remaining attempts and this gate's capped 4-call supplemental attempt failed
with real transient 503 ("high demand") then persistent 429 ("quota exceeded")
responses from Google's live API. Timeout/429/503/refusal handling all behaved
exactly as designed (`AiGenerationService.callWithRetry`, typed
`PROVIDER_TIMEOUT`/`PROVIDER_UNAVAILABLE`/`PROVIDER_REFUSED`, bounded retries).
`gemini-2.0-flash` is deprecated (confirmed via a real 404 from Google's API in
Gate 26); `gemini-3.8-flash` is the currently valid model. Status:
`QUOTA_VERIFICATION_REQUIRES_EXTERNAL_PROVIDER_ACCOUNT_ACTION` - this is not
claimed fixed, and no bypass was attempted.

## 7. Secret scan (Phase 10)

A full scan (git history, tracked files, working tree, scripts, reports, docs,
test fixtures, `.env.example` files) found the real Gemini key in exactly one
place: `apps/api/.env`, which is confirmed git-ignored and absent from git
history. No rotation is required.

## 8. Data integrity (Phase 11)

No destructive SQL and no schema migration were used this gate. Before/after
counts for all 15 tracked entities (see the JSON report's `dataIntegrity`
block) confirm every "protected" category (`Observation`, `ObservationVersion`,
`ObservationTrainingInterpretation`, `CaseStudySpecification`,
`CaseStudyVersion`) is **byte-for-byte unchanged**; growth is confined to
exactly the categories this gate's real work implies (`Question`/`QuestionVersion`
via governed publication and version-bump repair, `AiGenerationRun`/
`AiQuestionCandidate`/`AiCandidateQualityReview` via the real supplemental
Gemini attempt and the real quality reviews, and a first-ever `ExamBlueprint`/
`ExamBlueprintRule`/`Exam`/`ExamAttempt`/`Certificate` - each appearing exactly
once, matching "configure ONE real pilot blueprint" and "one real pilot exam
attempt"). The one direct database write this gate made (§4's residual-artifact
repair) touched only 2 already-known-correct scalar columns on 12 non-current,
already-superseded rows - no status, content, or governance field.

## 9. Full regression (Phase 12)

| Check               | Result       |
| ------------------- | ------------ |
| `pnpm format:check` | PASS         |
| `pnpm lint`         | PASS         |
| `pnpm typecheck`    | PASS         |
| `pnpm test`         | 683/683 PASS |
| `pnpm build`        | PASS         |
| `pnpm test:e2e`     | 406/406 PASS |

The one real failure encountered mid-gate (`case-study-generation-real-data.e2e-spec.ts`)
was caused by, and resolved together with, the defect in §4 - not a
pre-existing or unrelated regression.

## 10. Final decision

Per this gate's own rule, a single failing mandatory criterion forces
`NOT_PILOT_READY` regardless of how well everything else performs. Two fail:

- **≥20 published questions**: 18 achieved, blocked by external Gemini quota
  exhaustion (documented, not a code defect).
- **Every published question has complete ICH E6(R3) provenance** (section +
  Learning Objective for the DIRECT_GCP/CASE_APPLICATION chain this gate
  requires): 13 of 18 do; 5 do not (2 legacy unclassified + 3 sectioned
  DIRECT_GCP missing only an LO mapping).

Every other criterion this gate set out to prove is genuinely met: the real
blueprint/exam/attempt/scoring/certificate chain works end to end over real
HTTP with zero governance bypass, zero mass generation, zero second
architecture, zero answer-key exposure, zero unresolved duplicates, a clean
secret scan, fully accounted data integrity, and a fully green regression
suite (including a real defect this gate itself found, fixed, and
regression-tested).

## Decision: `NOT_PILOT_READY`

### Concrete blocking actions

1. Publish 2 more genuinely governed, human-approved questions with complete
   ICH E6(R3) provenance (SourceSection + Learning Objective) to reach the
   20-question minimum. Blocked by Gemini quota exhaustion, not by process or
   code - retry once provider quota is confirmed restored.
2. Map a real Learning Objective for `GCP-Q-001181`, `GCP-Q-002349`, and
   `GCP-Q-002350` (each already has a valid ICH E6(R3) section), or exclude
   them from the pilot-eligible pool and re-validate the blueprint against the
   remaining 13 fully-provenanced questions.
3. Resolve the Gemini quota exhaustion with the provider account
   (`QUOTA_VERIFICATION_REQUIRES_EXTERNAL_PROVIDER_ACCOUNT_ACTION`) before any
   further real-AI generation is attempted.

Engineering gates are **not yet closed**. These are the only remaining blocking
items, and neither requires new architecture, new gates, or speculative work -
per this gate's own instruction, no Gate 28 is proposed.
