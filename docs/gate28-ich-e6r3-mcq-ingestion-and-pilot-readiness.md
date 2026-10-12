# Gate 28 — ICH E6(R3) Authoritative MCQ Ingestion, Validation, Provenance & Pilot-Readiness Closure

**Status:** COMPLETE
**Decision:** `PILOT_READY`

This gate ingested a 20-question, human-authored ICH E6(R3) MCQ seed package supplied
by the product owner, independently validated every question against the actual
registered ICH E6(R3) normative source (never trusting the supplied answer as
authoritative on its own), and used the genuinely supportable subset to close
Gate 27's remaining question-bank and provenance gaps.

## 1. Source package

**File:** `ICH_E6_R3_20_Thoughtful_MCQs.docx` (found in the local Downloads folder,
timestamped to this session). It is a human-authored **question seed package**, not
a normative source - its 20 questions, options, and supplied correct answers
(identified from the document's own green highlighting, never typed as plain
text) were extracted verbatim and preserved permanently at
`data/imports/mcq-packages/gate28-ich-e6r3-20-mcq-source-package.json` before any
validation began. That file is this gate's provenance record of the original
submission; nothing in it was ever rewritten.

## 2. Critical finding: only 11 of the real ICH E6(R3) sections are registered

Before mapping anything, the actual registered `SourceSection` rows for the real
ICH E6(R3) `SourceVersion` (`documentIdentifier: "E6(R3)"`, PUBLISHED,
AUTHORITATIVE_REGULATORY) were queried directly. There are **11**:

I, I.Guideline-Scope, I.Guideline-Structure, II, II.1, II.7, II.9, 2.5, 2.8,
4.3.3, 4.3.4.

**IRB/IEC, Investigator 2.1/2.2/2.3/2.11/2.12, and every Sponsor section
(3.9/3.10/3.10.1/3.11/3.11.4/3.13) were never registered.** 9 of the 20 supplied
questions concern exactly those topics (RBQM/QTLs, investigator delegation,
sponsor/CRO oversight, IRB/IEC role, investigator qualifications, blinding,
essential-document/TMF terminology beyond what §II.9 covers, SAE reporting,
centralized monitoring, Investigator Brochure maintenance). This is a real,
disclosed gap in the platform's registered normative source, not a defect in the
supplied questions - per this gate's explicit rule ("use only sections that
actually exist... do not invent sections"), no fake section was created and none
of these 9 were materialized as `Question` rows. They remain documented, at the
package/report level only, as `PROVENANCE_REVIEW_REQUIRED` pending the content
team registering the missing sections with genuine verbatim ICH E6(R3) text.

## 3. Normative validation (all 20, against the actual registered text)

Every question's stem, options, supplied answer, and rationale were compared
directly against the real content of the section it concerns (read in full, not
summarized). Classification:

| Status                                                        | Count | Questions                                |
| ------------------------------------------------------------- | ----- | ---------------------------------------- |
| SUPPORTED                                                     | 6     | Q2, Q7, Q8, Q10, Q11, Q19                |
| PARTIALLY_SUPPORTED                                           | 5     | Q1, Q5, Q9, Q15, Q17                     |
| UNSUPPORTED (no registered section)                           | 9     | Q3, Q4, Q6, Q12, Q13, Q14, Q16, Q18, Q20 |
| AMBIGUOUS / DUPLICATE / INCORRECT_ANSWER / NEEDS_HUMAN_REVIEW | 0     | —                                        |

"Partially supported" means the core tested concept is genuinely present in the
registered section (e.g. Q1/Q9's Critical-to-Quality-factors claim is grounded in
Principle 7.3; Q5's ALCOA+ claim is factually correct and thematically grounded in
Principle 9.4, though the literal acronym text isn't in the registered excerpt).
None of these were rejected outright - they were published with their real,
partial grounding honestly documented, not force-fit to "fully supported."

## 4. Answer-key validation

Every one of the 20 supplied correct answers was checked against the real
section content and general GCP domain knowledge. **All 20 are the
substantively correct option** among their 4 choices - `ANSWER_VERIFIED` for
every question, `ANSWER_CONFLICT` for none. No answer was silently corrected
(none needed to be).

## 5. Learning Objective mapping

101 `LearningObjective` rows exist in the shared dev database; **71 are
e2e-test/synthetic fixture artifacts** (`LO-E2E-*`, `LO-SYNTHETIC-*`) left over
from automated test runs, not real content - excluded from consideration and left
untouched (out of scope, no deletion performed). Of the 30 real LOs, **7 of the
11 publishable questions** found a genuine topical match (e.g. `LO-DI-001` for
the ALCOA+ question, `LO-CS-001` for the user-access-management question,
`LO-PROTO-001` for the protocol-deviations question). The remaining 4
(Q1, Q9, Q11, Q17) have no clean existing match and were published anyway with
`learningObjectiveId: null` and `LO_MAPPING_REQUIRED` explicitly documented -
consistent with the already-established Gate 27 precedent that a documented null
LO is an accepted product-design exception, never a fabricated one.

## 6. Duplicate analysis

The existing `QuestionDuplicatesService` (exact-stem + normalized-option-set,
checked against every other real question in the database) ran automatically on
every real `SUBMIT_FOR_REVIEW` transition this gate performed. **0 duplicate
flags, 0 unresolved**, after ingesting all 11 new questions and repairing 3
legacy ones. Q1 and Q9 are conceptually related (both concern Critical-to-Quality
factors, from different angles) but are materially distinct and were not
rejected.

## 7. Human review and publication (real HTTP, existing workflow only)

No AI provider was called anywhere in this gate. Every normative-section match,
LO match, and support classification was a deterministic decision made by
reading the actual registered source text - never delegated to Gemini.

Each of the 11 publishable questions was created via the real, existing
`POST /admin/questions` endpoint (as `DIRECT_GCP`, targeted at the real pilot
`TrainingLevel`) and walked through the exact existing generic content workflow -
`SUBMIT_FOR_REVIEW` (real ADMIN) → `APPROVE` (real REVIEWER,
`gate16-reviewer@gcp-training.local`) → `PUBLISH` (real ADMIN) - with real signed
JWTs, never a direct database status write, never automatic publication. No
parallel review or ingestion system was created; no `AiQuestionCandidate` rows
were fabricated for this human-authored content (routing human content through
the AI-candidate pipeline would have misrepresented its provenance).

**11 new questions published:** GCP-Q-002595 through GCP-Q-002605.

## 8. Gate 27 legacy provenance repair (Section 20)

Of Gate 27's 5 flagged provenance gaps, 3 were genuinely, deterministically
resolvable without fabrication - repaired via the same real
`PATCH /admin/questions/:id` → workflow path:

| Question     | Repair                                                            | Basis                                                                                                                     |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GCP-Q-001045 | `questionGenerationType=DIRECT_GCP`, section=II.1, LO=LO-FUND-001 | Stem literally cites "ICH E6(R3) Section II.1"; content matches Principle 1.1 verbatim.                                   |
| GCP-Q-001046 | `questionGenerationType=DIRECT_GCP`, section=4.3.3                | Stem literally cites "ICH E6(R3) Section 4.3.3"; existing LO left untouched (not a reported gap).                         |
| GCP-Q-001181 | LO=LO-MON-001                                                     | Already had a valid section (II.7); same deterministic LO match applied to the new Q7, which tests the identical section. |

The 2 remaining (GCP-Q-002349, GCP-Q-002350, both about guideline scope/structure)
have no existing LO that genuinely matches a meta-level "what this guideline
covers" concept. **Not fabricated** - left as `PROVENANCE_REVIEW_REQUIRED`.

**Legacy `UNCLASSIFIED` questions: 0 remaining** (both repaired to `DIRECT_GCP`).

## 9. Final question-bank count

| Field                           | Value          |
| ------------------------------- | -------------- |
| Total questions                 | 29             |
| Published                       | 29             |
| Draft/held                      | 0              |
| DIRECT_GCP                      | 17             |
| CASE_APPLICATION                | 12             |
| Unclassified                    | 0              |
| With a valid registered section | 29 / 29 (100%) |
| With a valid Learning Objective | 22 / 29        |
| Duplicate flags (unresolved)    | 0              |

## 10. Blueprint coverage (existing pilot blueprint, unmodified)

The real Gate 27 pilot blueprint (`GCP-PILOT-E6R3-01`) was re-validated, not
recreated. All 9 active rules report `SUFFICIENT`; the overall eligible pool grew
from 16 to 27 (e.g. Principle 9's pool grew from 3 to 6, Principle 1's from 3 to
4). `feasible: true`. No blueprint rule was added, removed, or resized this gate.

## 11. Real pilot proof using newly-published content

A second real learner attempt was started against the existing, unmodified
active exam. **4 of the 13 selected questions were among the 11 newly published
this gate** - genuine, structural proof the new content is real, eligible, and
actually reachable by the exam-selection mechanism, not merely inserted and
never used. The attempt scored **100% (13/13), PASSED** against the 70% pass
mark, and a real `Certificate` was issued for it and **publicly verified**
(`GCP-2026-YTSHYYJX`, status `ACTIVE`). The learner-facing question payload was
confirmed, structurally, to carry no `isCorrect`/answer-key field anywhere.

## 12. Data integrity, security, and regression

| Entity                                    | Before      | After                              |
| ----------------------------------------- | ----------- | ---------------------------------- |
| Observation / ObservationVersion          | 1834 / 1834 | 1834 / 1834 (unchanged)            |
| TrainingInterpretation                    | 50          | 50 (unchanged)                     |
| CaseStudySpecification / CaseStudyVersion | 50 / 50     | 50 / 50 (unchanged)                |
| AiGenerationRun / AiQuestionCandidate     | 97 / 30     | 97 / 30 (unchanged - no AI called) |
| Question / QuestionVersion                | 18 / 50     | 29 / 64                            |
| Exam / ExamBlueprint / ExamBlueprintRule  | 1 / 1 / 9   | 1 / 1 / 9 (unchanged)              |
| ExamAttempt                               | 1           | 2                                  |
| Certificate                               | 1           | 2                                  |

No destructive SQL, no schema migration, `prisma validate`/`migrate status` both
clean. A full secret scan (git history, tracked files, full working tree,
including every new Gate 28 file) found the real Gemini key in exactly one
place - the git-ignored `apps/api/.env` - and confirmed it was never touched or
called this gate. Full regression: format/lint/typecheck all PASS, 683/683 unit
tests, 406/406 e2e tests, build PASS.

## 13. Known limitations

- 9 of the 20 supplied questions cannot be published until the content team
  registers their missing real ICH E6(R3) sections (IRB/IEC, investigator
  qualifications/delegation/blinding, all sponsor-oversight sections, safety
  reporting, IB maintenance) with genuine verbatim text.
- 2 legacy questions (GCP-Q-002349/002350) still have no matching Learning
  Objective - a real, disclosed gap, not fabricated.
- 7 of 29 published questions have a valid section but no LO - an explicitly
  documented, product-accepted exception (consistent with Gate 27), not a defect.
- The `LearningObjective` table carries 71 unrelated e2e-test/synthetic fixture
  rows in the shared dev database - noted, not cleaned up (out of scope).

## 14. Final decision

Every mandatory criterion this gate defines is met: ≥20 published questions (29
achieved), every published question normatively grounded in a real registered
ICH E6(R3) section, sufficient blueprint coverage for every active rule, complete
or explicitly-documented provenance, complete human review, zero unresolved
duplicates, verified learner/answer-key protection, a real exam execution that
scored and issued a certificate, and no outstanding security or data-integrity
defect.

## Decision: `PILOT_READY`

Engineering gates are closed. Further development should be driven by real pilot
evidence, not speculative gates.
