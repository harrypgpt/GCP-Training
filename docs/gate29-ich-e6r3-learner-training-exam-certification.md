# Gate 29 — ICH E6(R3) Learner Training, Controlled Examination & Certification

**Decision: PILOT_READY**

Machine-readable evidence: [`data/imports/observations/reports/gate29-ich-e6r3-learner-training-exam-certification-report.json`](../data/imports/observations/reports/gate29-ich-e6r3-learner-training-exam-certification-report.json)

## 1. Learner training flow

LOGIN → PROFILE → ENROLL → READ ICH E6(R3) → COMPLETE TRAINING → START EXAM → 20 MCQs one-at-a-time → SUBMIT → RESULT → PASS (≥80%) → CERTIFICATE, or FAIL → answer review → RETRAINING_REQUIRED → re-read → new attempt. Proven end-to-end with real HTTP calls against a real database in `apps/api/scripts/run-gate29-exam-config-and-e2e.ts`, whose full output is captured in `data/imports/observations/reports/gate29-exam-config-and-e2e-report.json`.

## 2. Complete source registration

ICH E6(R3) remains the platform's only normative training authority. Registered through the **existing** `Source` / `SourceVersion` / `SourceSection` architecture — no second document repository. The full 68-section official text (PDF → `pdftotext` → a documented, mechanically-verified parsing pipeline, never AI-rewritten) is now the current version (v3) of the single ICH E6(R3) `Source`. `SourceVersion` metadata: `documentIdentifier=ICH_E6_R3`, `version=Final`, `adoptionDate=2025-01-06`, `authority=AUTHORITATIVE_REGULATORY`, `externalAiEligibility=SAFE_FOR_EXTERNAL_AI`, `publicationStatus=PUBLISHED`. v1 (11 sections, referenced by the 29 already-published Gate 27/28 questions) was left untouched and still `PUBLISHED`.

### Section reconciliation (Section 37)

| | Count |
|---|---|
| Expected top-level chapters/sections (official TOC) | 68 |
| Registered (current version, v3) | 68 |
| Missing | 0 |
| Duplicate | 0 |

Disclosed granularity simplification: Appendices A/B/C and the Glossary are each one whole-text section rather than exploded into sub-headings — a deliberate, disclosed choice, not missing content. Carried-over limitation: 37 U+FFFD glyphs from the original PDF extraction were normalized to plain hyphens.

## 3. Document reader

`GET /api/learner/training/ich-e6r3` (overview: title/version/adoption date/TOC/progress/resume) and `GET /api/learner/training/ich-e6r3/sections/:sequence` (one section at a time, server records the view). UI: `apps/web/src/app/training/ich-e6r3/page.tsx` and `.../read/[sequence]/page.tsx`.

## 4. Download restriction

Verified by direct source inspection: no download button, no raw storage URL, and no signed download link exist anywhere in the reader service or reader UI. This is a platform-level restriction, not a claim that copying or screenshotting text is impossible.

## 5. Training completion enforcement

Deterministic: completion means the learner has reached the furthest real `SourceSection.sequence` in the current version — never elapsed time. Enforced server-side by the new `SourceReadingProgress` model and `IchE6R3ReadingService`; the frontend cannot mark completion on its own.

## 6. Exam configuration

20 questions, 80% pass threshold, blueprint-driven via the existing `ExamBlueprintRule` mechanism, extended with a new `questionGenerationType` dimension (mirroring Gate 25's `normativeSourceSectionId` precedent) — admin-configurable, not hardcoded.

## 7. Question composition

Default recommended composition: 12 DIRECT_GCP + 8 CASE_APPLICATION, expressed as ordinary blueprint rules. `ExamQuestionEligibilityService` remains the sole eligibility authority (extended, not duplicated).

## 8. Randomization

Question order and per-question option order are both cryptographically randomized (`secureShuffle` via `node:crypto randomInt`) — this was already implemented by Gate 7B and required no changes.

## 9. Option shuffling

Same mechanism as above; verified unchanged and still correct.

## 10. Duplicate prevention

Server-enforced via the pre-existing `Set<string>` selection algorithm and `validateSelection`'s uniqueness check; covered by a new unit test (`no-duplicates-even-on-fallback`) and e2e test.

## 11. Retake behavior

New logic in `ExamQuestionSelectionService.select()`: prefers the pool of questions unseen by the learner for this exam version; falls back to the full pool only when the unseen pool cannot satisfy the blueprint. `reusedQuestionIds` is recorded on every attempt for audit. In the real two-attempt proof, attempt 2 reused 14 of attempt 1's 20 questions — an honest result given a 29-question published pool, not concealed or misrepresented as full novelty.

## 12. Answer review

`GET /api/learner/exams/attempts/:attemptId/review` (new) is the **only** endpoint that ever exposes the answer key, and only once the attempt is finalized (409 while in progress). UI: `apps/web/src/app/exams/attempts/[attemptId]/review/page.tsx` — per-question YOUR ANSWER / CORRECT ANSWER / WHY, with explicit ICH E6(R3) or case-study reference and DIRECT_GCP/CASE_APPLICATION labeling.

## 13. 80% pass rule

Unchanged, reused from the existing scoring service; verified in both attempts of the real proof run (25% → FAILED, 100% → PASSED).

## 14. Retraining requirement

On FAILED evaluation, `LearnerExamScoringService` resets the learner's `SourceReadingProgress` to `RETRAINING_REQUIRED`. The next attempt is blocked (`409 TRAINING_NOT_COMPLETE`) until the guideline is fully re-read — proven in the real proof run's `exam-blocked-after-fail-retraining-required` step.

## 15. Certificate generation

Reuses the existing certificate engine. Requires `TrainingCompleted=true AND ExamPassed=true AND Score≥threshold AND Attempt finalized AND no invalidation condition`, enforced server-side and never bypassable via a direct API call. Title: "ICH E6(R3) GOOD CLINICAL PRACTICE TRAINING".

## 16. One-year validity

Exactly one year from completion date via deterministic date math. Real certificate: issued `2026-09-27T00:00:00.000Z`, expires `2027-09-27T00:00:00.000Z`.

## 17. Certificate verification

Public verification confirmed working end-to-end for the real certificate (`GCP-2026-NZW8MX3L`); response contains only certificate number, learner name, program/level name, dates, and status — no email, internal user ID, answer history, or question-bank internals.

## 18. DIRECT_GCP governance

Every DIRECT_GCP question in the real review output cites a real `ichE6R3Reference` (section identifier + heading) and no `caseApplicationReference`.

## 19. CASE_APPLICATION governance

Every CASE_APPLICATION question cites both its real `ichE6R3Reference` and a distinct `caseApplicationReference` (case code + title), keeping case studies clearly labeled as supporting material, never normative content.

## 20. Security tests (10 proofs)

1. Learner cannot start an exam before completing training — proven (`exam-blocked-before-any-training`, `exam-still-blocked-ich-reading-incomplete`).
2. Learner cannot alter exam configuration — learner endpoints accept no configuration fields; config is ADMIN-only.
3. Learner cannot retrieve correct answers during an active exam — `getAttemptQuestions` never selects `isCorrect`/`explanation`.
4. Learner cannot directly generate a certificate — server-side eligibility checks gate issuance; no bypass field exists.
5. Learner cannot bypass retraining after failure — proven (`exam-blocked-after-fail-retraining-required`).
6. Learner cannot download the official PDF through any app endpoint — verified by source inspection (no download/signed-URL code path).
7. API responses never contain the Gemini API key — confirmed by an independent secret scan of git history, tracked files, and the full working tree.
8. The hidden answer key is never exposed outside `getReview` — verified by code review and e2e coverage.
9. Answer keys are absent from learner-facing selects — verified by code review of the active-attempt query.
10. Certificate generation requires server-side eligibility checks — verified by code review and the real proof run's gated issuance step.

## 21. Unit tests

695/695 passed, including 12 new tests added this gate (`exam-question-selection.service.spec.ts` ×4, `ich-e6r3-reading.service.spec.ts` ×5, `learner-exam-attempt.service.spec.ts` +3).

## 22. E2E tests

410/410 passed across 29 suites, including the new `gate29-ich-e6r3-training-and-exam.e2e-spec.ts` (4 tests) and a fix to `gate25-ich-e6r3-section-coverage.e2e-spec.ts`'s "J/K/L/M" test (now reads the complete real guideline before starting its correctly ICH-grounded exam).

## 23. Real-data verification

No fake parallel database; every proof used real HTTP calls, real JWTs, and the real shared dev Postgres database. No mass-generation, mass-publication, or auto-approval occurred.

## 24. Database migration safety

One additive migration (`20261201000000_gate29_source_reading_progress_and_blueprint_generation_type`): one new enum, one new nullable column, one new table with FKs/indexes. No `DROP`/`DELETE`/`TRUNCATE`.

## 25. Before/after data counts

| Entity | Before (Gate 28 end-state) | After (Gate 29, post-e2e-cleanup) |
|---|---|---|
| Observation / ObservationVersion | 1834 / 1834 | 1834 / 1834 (unchanged) |
| TrainingInterpretation | 50 | 50 (unchanged) |
| CaseStudySpecification / CaseStudyVersion | 50 / 50 | 50 / 50 (unchanged) |
| AiGenerationRun / AiQuestionCandidate | 97 / 30 | 97 / 30 (unchanged — no AI called) |
| Question / QuestionVersion | 29 / 64 | 29 / 64 (unchanged) |
| SourceVersion / SourceSection | 1 / 11 | 3 / 147 |
| SourceReadingProgress | table did not exist | 7 |
| Exam / ExamBlueprint / ExamBlueprintRule / ExamVersion | 1 / 1 / 9 / 1 | 1 / 3 / 13 / 3 |
| ExamAttempt | 2 | 8 |
| Certificate | 2 | 3 |

See the JSON report's `dataIntegrity.deltaExplanation` for why each figure changed.

## 26. Known limitations

- 3 orphaned e2e-test fixture user rows (and their `SourceReadingProgress` rows) remain from earlier crashed debugging iterations of the new e2e suite, before it reached a fully green state. Disclosed, not cleaned up — mirrors Gate 28's own precedent.
- `SourceVersion` v2 (68 sections) is a superseded intermediate registration with a documented, fixed sequence-numbering defect; kept per the platform's non-destructive versioning policy, not deleted.
- Extra `ExamBlueprint`/`ExamBlueprintRule`/`ExamVersion` rows beyond the single logically-current configuration are superseded artifacts of iterative reconfiguration during development; harmless.
- With the current 29-question published pool and a 20-question exam, a second attempt can supply at most 9 genuinely unseen questions before controlled reuse kicks in — disclosed via `reusedQuestionIds`, not claimed as full novelty. Growing the pool would improve retake freshness.
- Appendices A/B/C and the Glossary are registered as single whole-text sections rather than exploded sub-headings (disclosed granularity choice).
- 37 U+FFFD replacement characters from the original PDF extraction were normalized to plain hyphens (disclosed, non-semantic).

## Architecture reused (not duplicated)

`Source`/`SourceVersion`/`SourceSection` versioning, `ExamBlueprintRule` dimension system, `ExamQuestionEligibilityService`, `ExamQuestionSelectionService`'s randomization/uniqueness engine, the existing certificate engine, and the existing exam-attempt UI (`Question X of Y`) — all extended in place, never forked into parallel systems.

## Files created/modified

See the JSON report and the conversation's file list; the main new production files are `ich-e6r3-reading.service.ts`, the `SourceReadingProgress` model/migration, the `questionGenerationType` blueprint dimension, the retake-preference logic in `exam-question-selection.service.ts`, the `getReview` endpoint, and the training/reading/review pages under `apps/web/src/app`.

---

**Gate 29 is complete. No Gate 30 is proposed.**
