# ICH E6(R3) Section Coverage & Blueprint Requirement Control (Gate 25)

## 1. Problem

Gate 24's audit found a genuine architectural gap: `ExamBlueprintRule` had
no dimension expressing "N questions required from ICH E6(R3) section X" -
only broader dimensions (domain, learning objective, question type,
difficulty, etc.). Every per-section coverage entry was therefore forced to
report `NO_REQUIREMENT_DEFINED`, honestly, but permanently, since no
mechanism could ever produce a real number. Gate 25 closes exactly this one
gap - nothing else.

## 2. Architecture before Gate 25 (inspected directly, not assumed)

- `ExamBlueprintRule` dimensions: `questionType`, `difficulty`, `domainId`,
  `professionalRoleId`, `levelId`, `learningObjectiveId`,
  `caseStudyRequired`, `sourceRequired`, plus `minimumCount`/`maximumCount`/
  `exactCount`. No section dimension existed.
- `ExamQuestionEligibilityService` was already the single, unmodified
  authority on "is this QuestionVersion examination-eligible"
  (PUBLISHED + current + active + option/answer integrity). It already
  filtered on every dimension above; it had no section filter.
- `ExamBlueprintCoverageService`/`ExamBlueprintValidationService` already
  computed required/available/shortfall and a 20+-point deterministic
  checklist per rule, reusing the eligibility service - there was no
  parallel coverage or validation engine to avoid duplicating.
- The real ICH E6(R3) authority was already identified deterministically
  (Gate 24): a `SourceVersion` row with `documentIdentifier === 'E6(R3)'`.
  This session confirmed by direct inspection that `Source`/`SourceVersion`
  have **no unique constraint** on title or `documentIdentifier` -
  duplicate registrations are structurally possible and must be actively
  checked, never assumed away.

None of this was rebuilt. Gate 25 adds one nullable FK and reuses every one
of the above services unmodified in shape, only feeding them one new,
optional dimension.

## 3. Architecture after Gate 25

```
ExamBlueprintRule
    |
    +-- normativeSourceSectionId? (nullable UUID, FK -> SourceSection, onDelete: Restrict)
```

No new table. No second section inventory, blueprint engine, eligibility
engine, provenance system, or ICH source system was created, per the gate's
own explicit prohibition. A shared utility,
`apps/api/src/modules/admin/exams/ich-e6r3-authority.util.ts`, centralizes
"which `SourceVersion`(s) are the registered ICH E6(R3) authority" -
`QuestionBankSufficiencyService` (Gate 24) was refactored to call the same
function rather than keeping its own private copy, so the two gates can
never define "ICH E6(R3)" differently.

## 4. Section identity model

A normative section is identified purely by the existing
`SourceSection.id` - the same identity Question/CaseStudy/Observation
provenance already uses. Nothing new was invented; Gate 25 only adds a
consumer of that existing identity.

## 5. Source validation

`assertNormativeSectionIsIchAuthoritative()` (in the shared util) is the
single acceptance check, invoked at both write time
(`ExamBlueprintService.assertRuleReferencesExist`) and independently
re-validated at activation time (`ExamBlueprintValidationService`, defense
in depth, mirroring Gate 22's promotion re-validation pattern). A section
passes only if, in order:

1. it exists,
2. its `SourceVersion.documentIdentifier` is the registered ICH E6(R3)
   identifier,
3. that `SourceVersion.reviewStatus` is `PUBLISHED`,
4. that `SourceVersion.authority` is `AUTHORITATIVE_REGULATORY`.

Any failure returns the single deterministic error code
`BLUEPRINT_NORMATIVE_SECTION_INVALID` - it never leaks which specific
sub-check failed, and never accepts an arbitrary UUID merely because a
`SourceSection` row with that id exists. Proven by a real e2e test that
constructs a genuinely `PUBLISHED`, `AUTHORITATIVE_REGULATORY`
`SourceVersion` whose `documentIdentifier` is deliberately **not**
`'E6(R3)'`, and confirms it is still rejected - the boundary is identity-
based, not merely "any authoritative regulatory source."

## 6. Blueprint rule behavior

- At most one normative section per rule (§6 of the prompt) - the field is
  a scalar FK, never an array. Two independent section requirements are
  two independent rules.
- More than one active rule in the same blueprint referencing the _same_
  section is rejected with `DUPLICATE_NORMATIVE_SECTION_REQUIREMENT` -
  never silently merged or summed. Checked both at write time
  (`ExamBlueprintService.assertNoDuplicateNormativeSections`, over the
  submitted rule set) and at validation time (a new, independent
  `no_duplicate_normative_section_requirements` check - it does not rely on
  `ruleSignature`'s full-dimension-combination check, since two rules could
  require the same section while differing in every other dimension).
- Existing rules without a section requirement are entirely unaffected -
  `normativeSourceSectionId` is nullable and every existing dimension-
  matching function (`ruleMatchesCandidate`, `ruleToEligibilityFilter`,
  `ruleHasNoDimension`, `ruleSignature`, `exclusiveGroupKey`) treats a null
  section exactly as it already treated every other unset dimension - no
  constraint.
- The existing `MAX_REQUIRED_QUESTIONS_PER_RULE` (100) and
  `MAX_TOTAL_REQUIRED_QUESTIONS` (500) limits apply identically to a
  section-constrained rule's count - no second limit system.

## 7. Coverage algorithm

`ExamBlueprintCoverageService.analyze()` gained one additional field per
rule, `normativeSection`, populated only when the rule has a section:

```ts
{
  normativeSourceSectionId, sectionCode, sectionTitle,
  status: 'SUFFICIENT' | 'SHORTFALL' | 'NO_ELIGIBLE_QUESTIONS'
}
```

`required`/`eligiblePool`/`shortfall`/`sufficient` are the exact same
fields every other rule already had - reused, not duplicated.
`status` is derived deterministically: `sufficient` → `SUFFICIENT`;
otherwise `eligiblePool === 0` → `NO_ELIGIBLE_QUESTIONS`; otherwise
`SHORTFALL`. A rule with a trivially-met requirement (`required === 0`)
is `SUFFICIENT` even with an empty pool - the gate's own §34 rule ("do not
confuse 'no eligible questions' with 'the section is defective'") is
enforced by checking `sufficient` first, not pool size first.

**`selected` is deliberately not reported here.** `ExamBlueprintCoverageService`
is a pre-attempt, diagnostic-only analysis - no attempt exists at the point
this report runs, so there is nothing to report as "selected." Inventing a
number here would misrepresent a diagnostic as if it reflected a real
attempt. This is a disclosed, deliberate interpretation choice (see
Limitations, §17), not an oversight.

## 8. Eligibility interaction

Zero new eligibility logic. `ExamQuestionEligibilityService.EligibilityFilter`
gained one optional field, `normativeSourceSectionId`, consumed by the
exact same `buildWhere()`/`evaluate()` pipeline every other filter already
went through - a section-constrained rule's eligible pool is still
PUBLISHED + current + active + integrity-checked, never a parallel check.
`EligibleCandidate` (and the Gate 7B/23 selection engine's
`CandidateDimensions`) gained the matching `sourceSectionRefId` field so
`ruleMatchesCandidate` could compare it - the exact same mechanism every
other dimension already used.

## 9. Publication interaction

A question's own persisted `sourceSectionRefId` (never inferred from stem,
prompt, keywords, domain, or case-study text - proven by an e2e test using
a real `DRAFT` question) only counts toward a section once that
_specific_ `QuestionVersion` is the current `PUBLISHED` version - proven by
a real e2e test: a `DRAFT` question grounded in the real ICH section
reports `NO_ELIGIBLE_QUESTIONS`; publishing that exact same question moves
the same rule to `SUFFICIENT`.

## 10. Activation behavior

Unchanged from Gate 22/23: `ExamsService.transition()` still calls
`ExamBlueprintValidationService.validate()` before `ACTIVATE`, and still
refuses with `409` on failure. A section-constrained rule automatically
participates in the existing `mandatory_rules_have_sufficient_pool` check
(item 19) for free, since `ruleToEligibilityFilter` now includes the
section filter - no new activation logic was written. Proven end-to-end by
a real e2e test: an exam whose section rule requires more than the real
eligible pool cannot activate (`409`); a real e2e test with a satisfied
section requirement activates (`200`) and a learner can start a real
attempt against it.

## 11. UI behavior

The existing blueprint editor
(`apps/web/src/app/admin/exams/[id]/blueprint/page.tsx`) gained one new
`<select>` per rule - "Normative ICH E6(R3) Section" - populated from the
new admin-only lookup endpoint, showing each section's real code and
heading (e.g. "2.5 — Essential Records"), never a raw UUID. No second
blueprint UI was created. The same page's coverage table gained an "ICH
E6(R3) section" column showing the code and a SUFFICIENT/SHORTFALL/
NO_ELIGIBLE_QUESTIONS badge. The existing Gate 24 readiness page's "ICH
E6(R3) section coverage" panel, which previously only ever showed
`NO_REQUIREMENT_DEFINED`, now shows a real required/available/shortfall
once a blueprint rule exists for that section.

## 12. Security

- `GET /api/admin/exams/ich-e6r3-sections` and all blueprint mutation
  routes remain `@Roles([UserRole.ADMIN])` on `ExamsController`, unchanged
  from Gate 22/23 - proven by e2e tests asserting a `REVIEWER` and a
  `LEARNER` both receive `403` when attempting to create a blueprint rule
  referencing a section.
- The new sections endpoint returns only `id`/`sectionIdentifier`/`heading`
  - no content, no internal database detail.
- `BLUEPRINT_NORMATIVE_SECTION_INVALID` never distinguishes "section
  doesn't exist" from "section belongs to a different source" from
  "source isn't published" - a single generic message, so no information
  about the database's internal state leaks through a validation error.

## 13. Audit

No second audit framework. The existing `EXAM_BLUEPRINT_CREATED`/
`EXAM_BLUEPRINT_UPDATED` audit events (unchanged `AuditAction` values) now
carry an additional `normativeSectionRequirements: string[]` metadata
field listing which sections the submitted rule set requires.

## 14. Migration safety

One migration, purely additive - manually reconfirmed:

```sql
ALTER TABLE "exam_blueprint_rules" ADD COLUMN "normative_source_section_id" UUID;
CREATE INDEX "exam_blueprint_rules_normative_source_section_id_idx" ON "exam_blueprint_rules"("normative_source_section_id");
ALTER TABLE "exam_blueprint_rules" ADD CONSTRAINT "exam_blueprint_rules_normative_source_section_id_fkey"
  FOREIGN KEY ("normative_source_section_id") REFERENCES "source_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Zero `DROP`/`DELETE`/`TRUNCATE` (the `ON DELETE RESTRICT` clause is the
FK's _delete-behavior policy_, not a data-deleting statement). `ON DELETE
RESTRICT` was deliberately chosen over the `SetNull` every other FK to
`SourceSection` uses (`QuestionVersion`, `CaseStudy`, `Observation`,
`AiQuestionCandidate`) - losing this reference would silently corrupt a
blueprint's stated requirement, unlike losing a citation elsewhere, which
only loses informativeness. This is a disclosed, deliberate deviation from
the codebase's general convention, made for exactly the reason §21 of the
prompt asked for.

## 15. Backward compatibility

Every existing blueprint rule (Gate 22/23's own e2e/unit fixtures, and any
real rule created before Gate 25) continues to function unchanged -
`normativeSourceSectionId` is nullable and every function that consumes
`RuleDimensions`/`CandidateDimensions` treats a null section as "no
constraint on this axis," identical to how every other optional dimension
already behaved. Proven by re-running the complete pre-existing
`exam-blueprint-rule.util.spec.ts`/`exam-selection.util.spec.ts`/
`exam-blueprint-coverage.service.spec.ts`/`exam-blueprint-validation.service.spec.ts`
suites unmodified in intent (only fixture objects gained the new field,
set to `null`) - all still pass.

## 16. Real-data findings

`scripts/run-gate25-real-data-verification.ts`, run against the real dev
database via a real signed JWT for `data-import-admin@gcp-training.local`
(full report in
`data/imports/observations/reports/gate25-real-data-verification.json`):

```text
ICH E6(R3) authority: SINGLE_AUTHORITATIVE_SOURCE (1 Source, 1 SourceVersion)
Total ICH sections: 11
Total questions: 7 (all still DRAFT - none PUBLISHED)
Normative grounding: 0 valid / 0 missing for both types (no eligible/PUBLISHED question exists yet)
Total real exams configured: 0
Blueprints with coverage: 0
Generation gaps: none (no blueprint rule exists yet to define a requirement)
Overall status: PARTIALLY_READY
```

Consistent with Gate 24's own finding: the real platform is not yet
examination-ready, but purely because no question has been published and
no exam/blueprint has been configured - not because of any defect in the
architecture Gate 25 just extended. `sources: 1`/`sourceVersions: 1`
confirms the real database has exactly one ICH E6(R3) registration, with no
duplication risk today.

## 17. Limitations

- `selected` is not reported in blueprint-level coverage (§7) - it is not
  a meaningful concept before an attempt exists, and this report runs
  before any attempt is created. Per-attempt section fulfillment could be
  added to the _attempt_ assembly/result path in a future gate if a real
  need for it arises - deliberately not added speculatively here.
- The section selector UI lists every registered ICH E6(R3) section
  regardless of how many already have a blueprint rule elsewhere in the
  same exam or across other exams - it does not warn an admin in advance
  that a section is already claimed; that feedback only appears after
  attempting to save (`DUPLICATE_NORMATIVE_SECTION_REQUIREMENT`).
- `caseApplicationEligibleCount`/`directGcpEligibleCount` breakdowns for a
  _section_ (as opposed to a learning objective, which already had them
  since Gate 24) were not added - out of scope for the one gap this gate
  set out to close.

## 18. Future work

If ICH-section-level requirements turn out to matter enough in practice
that admins want to see, before saving, which sections are already
claimed across all of an exam's rules, that would be a small, well-scoped
UI-only follow-up - no new backend architecture would be needed, since
`assertNoDuplicateNormativeSections` already contains the exact rule. A
genuinely new gate would only be warranted if per-attempt section
fulfillment tracking became a real product requirement.
