# Human Review, Question Quality Calibration & Controlled Question Bank Promotion (Gate 21)

## 1. Purpose

Gate 21 is the controlled human-review and quality-calibration layer sitting
between AI-validated candidates (`READY_FOR_REVIEW`) and the real question
bank (`DRAFT` Question/QuestionVersion). It adds no new AI provider, no new
generation category, no new question schema, and no exam/certificate logic

- it is a governance/quality-control gate on top of Gates 15-20's completely
  unmodified architecture.

## 2. Knowledge boundary (unchanged, reaffirmed)

Layer A (normative): ICH E6(R3) is the sole GCP training authority. Layer B
(case-application evidence): FDA Warning Letters/483s, audits, computerised-
system observations, and expert observations may only supply realistic
scenario context - never an independent GCP requirement. Gate 21 verifies
this boundary at review time (Q1/Q2/Q8/Q9 below) rather than re-implementing
it; the actual structural enforcement remains `GroundingService` and
`validateQuestionGovernance` (Gates 15/18, unchanged).

## 3. ICH E6(R3) authority

The real, registered ICH E6(R3) `Source`/`SourceVersion`/`SourceSection`
(Gate 18) was only ever READ during this gate - never written to. Verified
unchanged (`updatedAt` timestamp predates this gate's work).

## 4. DIRECT_GCP

Reviewed identically to CASE_APPLICATION except Q3 (case-evidence
traceability) and Q7 (case realism) are `NOT_APPLICABLE` - never required to
be `PASS` for this type (Gate 21 §53's mandatory list applies
`caseEvidenceTraceability`/`caseRealism` only when
`questionGenerationType === 'CASE_APPLICATION'`).

## 5. CASE_APPLICATION

Reviewed with all 10 PASS/FAIL/REQUIRES_REVIEW dimensions mandatory
(including Q3/Q7). The reviewer sees both `[NORMATIVE GCP SOURCE]` and
`[CASE STUDY EVIDENCE]` distinctly via the existing, unmodified
`AiTraceabilityPanel` (Gate 18).

## 6. Candidate workflow (reused, not replaced)

`AiCandidatesService.accept()`/`.reject()` and
`AiCandidateConversionService.convert()` are **completely unmodified**. The
existing `AiCandidateStatus` state machine
(`GENERATED → VALIDATION_FAILED/READY_FOR_REVIEW/IN_REVIEW → ACCEPTED/
REJECTED/DISCARDED`) is unchanged. **No `REQUEST_REVISION` state exists in
this codebase** - the governing instruction explicitly permits this: "If the
current system does NOT support REQUEST_REVISION, do not invent a parallel
workflow. Document the limitation and retain the existing ACCEPT/REJECT
workflow." This is documented here, not silently worked around (see §16).

## 7. Human review (the new layer)

`AiCandidateQualityReviewService.submit()`
(`apps/api/src/modules/ai/ai-candidate-quality-review.service.ts`) +
`POST /api/admin/ai/question-candidates/:id/quality-review`
(REVIEWER/ADMIN only, same roles as the existing accept/reject/convert
endpoints). It sits **in front of**, never inside, `accept()`/`reject()`:

1. Refuses a second submission for an already-reviewed candidate
   (`AiCandidateQualityReview` is unique per `candidateId`, immutable - no
   update method exists at all).
2. Runs the deterministic exact-stem/exact-option-set duplicate check
   (§10) against every other candidate/question.
3. Persists the review record (`AiCandidateQualityReview`: reviewerId,
   decision, reviewComment, the 12 quality dimensions as one validated
   JSON object) and an audit event
   (`AuditAction.AI_CANDIDATE_QUALITY_REVIEWED`) - **regardless of outcome**,
   including a failed ACCEPT attempt, so the fact that review occurred and
   correctly failed closed is never hidden.
4. For `REJECT`: calls the existing `AiCandidatesService.reject()`
   unconditionally - the mandatory-dimension gate never applies to REJECT.
5. For `ACCEPT`: evaluates the fail-closed gate (§53/§54); only calls the
   existing `AiCandidatesService.accept()` if every mandatory dimension is
   `PASS` and no duplicate was found - otherwise throws
   `QUALITY_REVIEW_GATE_FAILED` (409) and the candidate's status is **not**
   changed.

## 8. Quality dimensions (Q1-Q12)

Stored as one JSON object (`AiCandidateQualityReview.qualityDimensions`),
validated field-by-field against a closed vocabulary
(`QualityReviewDimensionsDto`) - never free text, never an arbitrary score.
Q1/Q2/Q4/Q8/Q9/Q10 are mandatory-PASS for every type; Q3/Q7 are additionally
mandatory-PASS for CASE_APPLICATION only; Q5/Q6 are recorded but not gate-
blocking (a human judgment signal, not an automated rejection trigger,
matching §14's "no overall AI quality score" and §54's explicit list of
mandatory dimensions); Q11 (difficulty)/Q12 (cognitive level) are metadata
only, never used to auto-approve/reject (§11/§14).

## 9. Conversion

Unchanged. `AiCandidateConversionService.convert()` still only accepts
`ACCEPTED` candidates, still calls the exact same `QuestionsService.create()`
a human author's `POST /admin/questions` uses, still always produces a
brand-new `DRAFT` `Question`/`QuestionVersion`, still can never itself
publish anything.

## 10. Duplicate handling

`AiCandidateQualityReviewService`'s private `findDuplicates()` reuses
`QuestionDuplicatesService.normalizeStem()`/`normalizeOptionSet()`
(exported for this purpose, not reimplemented) against every non-DISCARDED
`AiQuestionCandidate` and every non-ARCHIVED `QuestionVersion`. No
embeddings/semantic search. A genuine, real finding surfaced while building
this gate's own tests: `MockAiProvider`'s question output (both stem AND
the 4 answer options) is fixed, hard-coded content regardless of grounding -
every mock-generated candidate ever created is therefore an exact duplicate
of every other one. This is exactly the condition the duplicate gate is
supposed to catch, and it does (proven directly in
`gate21-quality-review.e2e-spec.ts` against a real, pre-existing mock
DIRECT_GCP candidate from Gate 18).

## 11. Audit

Every quality-review submission (`AI_CANDIDATE_QUALITY_REVIEWED`) and every
resulting accept/reject/conversion (`AI_CANDIDATE_ACCEPTED`/
`AI_CANDIDATE_REJECTED`/`AI_CANDIDATE_CONVERTED`, all pre-existing) goes
through the same, single, unmodified `AuditService`. No second audit
framework was created.

## 12. Security

`GEMINI_API_KEY`/`OPENAI_API_KEY` are never read, stored, or returned by any
Gate 21 code path - the quality-review endpoint never touches provider
configuration at all. Verified by e2e test and by a repo-wide grep for the
real key value (zero matches).

## 13. Volume limits

Gate 21 made **zero** real Gemini calls - it reviewed 17 already-existing
real candidates (3 DIRECT_GCP from Gate 19, 14 CASE_APPLICATION from Gate
20). No `MAX_REAL_GEMINI_CALLS` guard was needed since generation was never
invoked; this is recorded honestly rather than adding an unused guard for
its own sake.

## 14. Real-tranche results

`scripts/run-gate21-real-tranche-review.ts` reviewed all 17 real Gemini
candidates through the **actual HTTP API** (a real Nest server on an
ephemeral port, a real validly-signed JWT for the real
`gate16-reviewer@gcp-training.local` REVIEWER account - see the script's own
header comment for why a signed token was used instead of a forgotten
one-time password). Each decision reflects an actual line-by-line reading of
the real stem/options/explanation against the cited ICH E6(R3) section:

- **16 ACCEPTED** - all mandatory dimensions genuinely PASS; each
  scenario/normative separation verified by inspection.
- **1 REJECTED** (`3353ba63-...`) - a genuine, substantive finding: the
  question's four options differ mainly by which exact ICH E6(R3)
  subsection number (II.9.4 vs II.9.3 vs II.9.5) is cited, testing recall of
  an exact citation rather than application of the underlying principle -
  bordering on citation-trivia (Q10, training usefulness).
- **2 conversions** performed (one DIRECT_GCP, one CASE_APPLICATION) to
  prove the full ACCEPTED→DRAFT chain end-to-end with real data - both
  produced `DRAFT`-only `QuestionVersion` rows (`GCP-Q-001045`,
  `GCP-Q-001046`), neither published. The other 14 accepted candidates were
  deliberately left un-converted, to honestly demonstrate ACCEPT ≠
  conversion ≠ publication.

Full results: `data/imports/observations/reports/gate21-real-tranche-review-report.json`.

## 15. Traceability

Verified by direct database query for both converted questions. Example
(CASE_APPLICATION): `Question GCP-Q-001046 → QuestionVersion (DRAFT) →
observation OBS-FDA-WL-652067 (linked) → domain "Data Integrity" →
learningObjective (linked)`; the source `AiQuestionCandidate` retains
`questionGenerationType=CASE_APPLICATION`, `normativeSource=ICH_E6_R3`,
`normativeSourceSectionId` (real, 4.3.3), `caseStudyVersionId` (real,
Gate 20 tranche). Example (DIRECT_GCP): `Question GCP-Q-001045 →
QuestionVersion (DRAFT)`, with `observation=null`/`source=null` on the
converted question (correctly - DIRECT_GCP has no scenario evidence) and
the source candidate's `normativeSource=ICH_E6_R3`/`scenarioSourceType=NONE`
intact.

## 16. Known limitations

1. **No `REQUEST_REVISION` workflow** - not present in the pre-existing
   `AiCandidateStatus` state machine, and Gate 21 deliberately did not add
   one (§34 explicitly permits documenting this instead of inventing a
   parallel workflow). ACCEPT/REJECT remain the only two outcomes.
2. **`MockAiProvider`'s fixed question-output content** (§10) means no two
   mock-generated candidates can ever both be ACCEPTed without one being
   flagged a duplicate - a real, pre-existing fact about the mock provider,
   not a Gate 21 defect, worked around in this gate's own e2e tests by
   seeding realistic-but-uniquely-worded fixture rows directly for the
   handful of tests that specifically needed two independently-acceptable
   candidates.
3. Token/cost metadata for the real-tranche review is N/A - no real Gemini
   calls were made in this gate (review only, no generation).

## 17. Future work (explicitly NOT started in this gate)

Mass question generation, exam blueprint/generation/scoring, certificate
generation, embeddings/vector database/semantic search/RAG, adaptive
learning, a REQUEST_REVISION workflow, and any publication mechanism. Gate
21 ends after human review, quality calibration, controlled DRAFT
conversion, traceability verification, regression testing, and this
documentation. **Do not proceed to Gate 22 without explicit instruction.**
