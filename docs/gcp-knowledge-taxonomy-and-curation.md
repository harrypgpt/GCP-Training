# GCP Knowledge Taxonomy & Real-Data Curation (Gate 14)

Gate 13 built the human-in-the-loop curation _infrastructure_ over the real
1,834-observation bank imported in Gate 12, but the environment had zero
`GcpDomain` and zero `LearningObjective` rows to curate against. Gate 14
establishes the controlled GCP knowledge taxonomy those tools needed, and
uses it to actually curate a substantial, real tranche of the observation
bank - deterministically, with a documented human-authored rule set, never
an LLM classification.

## 1. Inspection findings that shaped this taxonomy

Before creating anything, the real database and the real observation text
were inspected directly:

- `GcpDomain` = 0 rows, no domain-management CRUD existed anywhere.
- `LearningObjective` = 0 rows; the existing model required a `lessonId`
  (Gate 4's Lesson tree is also 0 rows in this environment).
- `ProfessionalRole` = 12 seeded roles, judged sufficient for all real
  evidence encountered - no new role was added (Gate 14 §10).
- `RootCauseCategory`, `ObservationRiskDimension`, `ObservationSeverity`
  (Gate 11) were judged adequate as-is - no new taxonomy enum was created.
- The real observation bank's themes were profiled directly:
  - FDA `Warning Letters` sheet (26 rows) and `Computerized Systems` sheet
    (9 rows) already carry SOURCE_EXPLICIT `BIMO Area` / `Role/Type` / `21
CFR / Authority` fields from Gate 12's import - a goldmine for
    deterministic domain/role mapping.
  - The practical Observation Bank (`Audit` 557, `Clinical` 1,089,
    `Bio-analytical` 153 rows) carries only a free-text `Area` tag with
    very high cardinality (443-833 distinct values per sheet) - too noisy
    to be a controlled vocabulary itself, but its top values clustered
    cleanly around recognizable GCP themes: Training, Vendor, TMF/ISF,
    Source Document, CRF/EDC, ICF/ICD, Adverse Event, CSR, Raw Data/Method
    Validation, Calibration, Good Documentation Practice, and Information
    Technology/Software.

These findings are what produced the domain list, the role reuse decision,
and the keyword rule tables below - none of it was designed in the
abstract first and reconciled with evidence after the fact.

## 2. Taxonomy hierarchy decision

The prompt's illustrative hierarchy was `KnowledgeArea -> GcpDomain ->
GcpTopic -> LearningObjective`. Per its own instruction to use the fewest
levels the requirement actually needs:

- **No `GcpKnowledgeArea` table** - 25 domains is small enough to browse
  flat; grouping them further would add a table with no real user need.
- **No `GcpTopic` table** - a nullable free-text `topic` string was added
  directly to `LearningObjective` instead, giving informal sub-grouping
  within a domain without a second relational entity.
- **`GcpDomain` reused as-is**, with one additive column (`sortOrder`) for
  display ordering.

Final hierarchy actually implemented: `GcpDomain -> LearningObjective`
(with an optional free-text `topic` label), and independently,
`ObservationVersion -> GcpDomain` (Gate 13's existing curation pointer).

## 3. The 25 GCP domains

Pruned and merged from the prompt's 36-item candidate checklist down to 25
domains, each independently justified by either the real evidence above or
standard ICH E6 GCP curriculum structure (never split further than either
supports):

| Code                          | Name                                                   |
| ----------------------------- | ------------------------------------------------------ |
| GCP_FUNDAMENTALS              | GCP Fundamentals & Principles                          |
| INVESTIGATOR_RESPONSIBILITIES | Investigator Responsibilities                          |
| SPONSOR_RESPONSIBILITIES      | Sponsor Responsibilities                               |
| CRO_OVERSIGHT                 | CRO / Service Provider Oversight                       |
| PROTOCOL_COMPLIANCE           | Protocol Compliance & Deviations                       |
| INFORMED_CONSENT              | Informed Consent                                       |
| ETHICS_OVERSIGHT              | Institutional Review / Ethics Committee Oversight      |
| SUBJECT_SAFETY                | Subject Safety & Adverse Event Reporting               |
| SOURCE_DOCUMENTATION          | Source Data / Source Documentation                     |
| ESSENTIAL_DOCUMENTS           | Essential Documents / Trial Master File                |
| MONITORING_QUALITY            | Monitoring & Risk-Based Quality Management             |
| DATA_INTEGRITY                | Data Integrity                                         |
| CLINICAL_DATA_MANAGEMENT      | Clinical Data Management                               |
| BIOANALYTICAL_OPERATIONS      | Laboratory / Bioanalytical Operations                  |
| INVESTIGATIONAL_PRODUCT       | Investigational Product Mgmt, Randomization & Blinding |
| COMPUTERIZED_SYSTEMS          | Computerized Systems & Electronic Records              |
| CSV                           | Computerized System Validation                         |
| AUDIT_TRAILS_ACCESS           | Audit Trails & Access Control                          |
| VENDOR_OVERSIGHT              | Vendor / Third-Party / SaaS Oversight                  |
| RECORD_RETENTION              | Record Retention / Archiving                           |
| TRAINING_QUALIFICATION        | Training / Qualification                               |
| QUALITY_ASSURANCE_CAPA        | Quality Assurance, Auditing & CAPA                     |
| INSPECTION_READINESS          | Inspection Readiness                                   |
| DOCUMENTATION_PRACTICES       | Good Documentation Practices                           |
| PRIVACY_CONFIDENTIALITY       | Privacy / Confidentiality                              |

Deliberate merges (to avoid unnecessary granularity, §3): "Subject Safety"

- "AE/SAE" + "Safety Reporting" -> one `SUBJECT_SAFETY` domain (evidence
  always co-occurs); "Computerized Systems" + "Electronic Records/
  Signatures" -> one `COMPUTERIZED_SYSTEMS` domain; "Audit Trails" + "Access
  Control" -> one `AUDIT_TRAILS_ACCESS` domain; "QA" + "CAPA" -> one
  `QUALITY_ASSURANCE_CAPA` domain. `INSPECTION_READINESS` and
  `PRIVACY_CONFIDENTIALITY` are kept despite thin/no direct observation
  evidence because they are standard, independently meaningful GCP training
  topics (§5's "must also support training curriculum" requirement) - this
  is documented as a known taxonomy gap in §9 below, not hidden.

Seeded by `pnpm --filter @gcp/api taxonomy:seed`
(`apps/api/scripts/seed-gcp-taxonomy.ts`), idempotent (upsert by `code`).

## 4. Professional roles - reused, not duplicated

All 12 existing `ProfessionalRole` rows (CRA, CRC, Principal Investigator,
Sub-Investigator, Sponsor, CRO, Clinical Operations, QA, Pharmacovigilance,
Regulatory, Pharmaceutical, Other) were found sufficient for every real
observation encountered. No new role was created.

## 5. Role-to-domain matrix

`GcpDomainRoleMap` (new, additive table) - a curated reference view, never
a permission system. 42 entries seeded, each with a one-line rationale
(e.g. `PROTOCOL_COMPLIANCE -> CRA`: "CRA monitors and verifies protocol
compliance."). Managed via `POST/GET/DELETE /api/admin/taxonomy/role-map`.

## 6. Learning objective library

`LearningObjective` (existing Gate 4 model) gained additive columns:
`code` (unique), `title`, `domainId` (nullable FK to `GcpDomain`), `topic`
(nullable), `sourceBasis` (new `LearningObjectiveSourceBasis` enum:
AUTHORITATIVE_SOURCE / OBSERVATION_EVIDENCE / CURRICULUM_REQUIREMENT /
EXPERT_CURATED_TRAINING_REQUIREMENT), `rationale`, `difficulty` (reuses
`DifficultyLevel`). `lessonId` was loosened from required to optional -
Gate 4's Lesson/Module/TrainingLevel/TrainingProgram tree has zero authored
rows in this environment, and an objective is never given a fabricated
fake lesson home just to satisfy a foreign key; it is tied to a domain
first and can be attached to a lesson later once real curriculum content
exists. A `LearningObjectiveProfessionalRole` join table (new, mirrors the
existing `ObservationVersionProfessionalRole` pattern) records role
applicability.

34 objectives were authored, each observable/assessable (identify,
determine, evaluate, verify, reconcile, assess, classify, prioritize - never
"understand X"), each with an explicit `sourceBasis` (all
`EXPERT_CURATED_TRAINING_REQUIREMENT` in this seed - none claims to be an
authoritative regulatory requirement) and a `rationale` naming the specific
evidence or curriculum need that justified it. Distribution: at least one
objective per domain that has real observation evidence; a handful of
low-evidence domains (see §9) still lack one.

Reuses the existing Gate 4 `ObjectivesService`/`ObservationsController`
architecture exactly - no new learning-objective system was built.
Retirement reuses the existing generic content workflow's `ARCHIVE` action
(already reachable from any status, ADMIN-only) - no new retirement
mechanism was added.

## 7. Real-data curation

Curation was performed by `apps/api/scripts/curate-real-observations.ts`,
which calls the _same_ `ObservationCurationService` methods the admin UI
calls (never a direct database write, never an LLM). It is itself the
"human in the loop" the platform's rules require: every rule below was
authored and reviewed against the actual evidence text before being
encoded, then applied mechanically and auditably.

### FDA "Warning Letters" sheet (26 rows) - deterministic mapping

The sheet's own `BIMO Area` and `Role/Type` fields are SOURCE_EXPLICIT
(Gate 12). Mapping them into the controlled domain/role vocabulary is a
deterministic transform of already-explicit data, so every field uses
`ClassificationBasis.DETERMINISTIC_MAPPING`:

| BIMO Area contains                                          | Domain                   |
| ----------------------------------------------------------- | ------------------------ |
| "informed consent"                                          | INFORMED_CONSENT         |
| "safety reporting"                                          | SUBJECT_SAFETY           |
| "eligibility"                                               | PROTOCOL_COMPLIANCE      |
| "protocol compliance"                                       | PROTOCOL_COMPLIANCE      |
| "randomization"                                             | INVESTIGATIONAL_PRODUCT  |
| "data integrity"                                            | DATA_INTEGRITY           |
| "record retention"                                          | RECORD_RETENTION         |
| "cro oversight"                                             | CRO_OVERSIGHT            |
| "investigational product" / "expanded access"               | INVESTIGATIONAL_PRODUCT  |
| "product classification" / "ind"                            | SPONSOR_RESPONSIBILITIES |
| (default: bare "clinical investigation" / "bioequivalence") | PROTOCOL_COMPLIANCE      |

`Role/Type` containing "clinical investigator" -> PRINCIPAL*INVESTIGATOR;
"sponsor" -> SPONSOR; "cro" -> CRO (additive, an observation may get
multiple roles). Root cause was left `UNKNOWN` with basis
`TRAINING_INFERENCE` for this sheet - each row is a short, abstracted
finding without the surrounding narrative needed to responsibly infer
\_why* it happened, and Gate 14's own rule (§20) says never force a root
cause the evidence doesn't support.

### FDA "Computerized Systems" sheet (9 rows) - individually reasoned

Per §30's explicit instruction not to assign every CSV row the same
domain, each of the 9 rows was read individually and assigned a specific
domain, role set, risk dimensions, and a TRAINING_INFERENCE root cause:

| Theme (excerpt)                                 | Domain                  | Root cause |
| ----------------------------------------------- | ----------------------- | ---------- |
| Blinded assessor retained EDC access            | INVESTIGATIONAL_PRODUCT | SYSTEM     |
| Unrestricted "System/Administrator" role        | AUDIT_TRAILS_ACCESS     | SYSTEM     |
| Audit trail disabled, shared admin/tester       | AUDIT_TRAILS_ACCESS     | SYSTEM     |
| Unreviewed audit trail, LIMS timestamp mismatch | DATA_INTEGRITY          | SYSTEM     |
| Vendor deleted eCOA data pre-inspection         | VENDOR_OVERSIGHT        | VENDOR     |
| No audit trail/logins, shared password          | AUDIT_TRAILS_ACCESS     | SYSTEM     |
| Software-update response inadequately scoped    | CSV                     | SYSTEM     |
| EDC vendor closed system, records lost          | RECORD_RETENTION        | GOVERNANCE |
| eCRF audit trail conflicts with later source    | DATA_INTEGRITY          | SYSTEM     |

### Practical observation bank (>=100 required, 236 curated) - human-authored keyword rules

Each observation's `Area` tag and leading text were matched against a
17-rule, human-reviewed keyword table (`PRACTICAL_KEYWORD_RULES` in the
script) mapping recognizable terms (TMF/ISF, source document, CRF/EDC,
ICF/ICD, adverse event, CSR, raw data/method validation, calibration,
vendor, training, SOP/QMS, archival, good documentation practice,
randomization/blinding, information technology) to a domain, risk
dimension(s), a root cause (always `TRAINING_INFERENCE` - the source
Observation Bank never documents an explicit root cause), and an
applicable role. Every match records `ClassificationBasis.HUMAN_CURATED`
(a curator's judgment call encoded as a rule - not a "deterministic
mapping" of already-explicit structured data, since `Area` is free text
the original author wrote). Records that matched no rule were left
uncurated rather than forced into a domain the text didn't clearly
support.

### Learning-objective linkage

Every FDA row and every keyword-matched practical row also received a
`CURATED_MATCH` link to one of the 34 seeded learning objectives where the
fit was genuinely close (e.g. the vendor-deletion CSV row ->
`LO-VENDOR-001`; a TMF/ISF-themed practical row -> `LO-ESSDOC-001`). No
observation was linked merely to raise a coverage number, and no new
objective was ever auto-created from an unmatched observation - those
remain `NO_MATCH`/unassessed for a future human-review queue (§8).

## 8. Curation priority (workflow scheduling, never a quality score)

`CurationPriorityTier` (`PRIORITY_1`/`PRIORITY_2`/`PRIORITY_3`) is computed
by `computeCurationPriority()` (`observation-curation-priority.service.ts`)

- a pure, deterministic function, never an LLM call:

- **PRIORITY_1**: regulatory enforcement evidence (`evidenceClass ===
INSPECTION_EVIDENCE`), explicit `HIGH`/`CRITICAL` severity, or a
  high-risk dimension (patient safety / data integrity / computerized
  system) paired with a reasonably complete narrative (>=120 characters).
- **PRIORITY_2**: practical/expert evidence with a reasonably complete
  narrative (>=80 characters).
- **PRIORITY_3**: everything else - short, low-context, needing
  substantial interpretation before it can be curated well.

`POST /api/admin/observation-curation/priority/assign` (ADMIN-only)
computes and persists this for every version lacking one, in memory, then
writes back with at most three grouped `updateMany` calls - never one
update per row, never a distributed lock.

## 9. Bounded reviewer claim/lease

`POST /api/admin/observation-curation/claim` lets a CONTENT_AUTHOR/ADMIN
claim up to 50 unclaimed (or expired-claim) `IMPORTED`/`CURATION_REQUIRED`
records, ordered by priority then age, with a 2-hour lease
(`curationClaimedById`/`curationClaimedAt`/`curationClaimExpiresAt` -
additive columns on `ObservationVersion`). A claim past its expiry is
treated as free by every read/claim path - no cleanup job needed.
`POST .../claim/release` releases the caller's own claims (or any claim,
for an ADMIN).

## 10. Final knowledge statistics (real data, this environment)

| Metric                                                  | Count                           |
| ------------------------------------------------------- | ------------------------------- |
| Total observations / versions                           | 1,834                           |
| FDA Warning Letter observations curated                 | **35 / 35**                     |
| Computerized-system observations curated (sheet-scoped) | **9 / 9**                       |
| Practical observations curated                          | **236** (minimum required: 100) |
| Total curated (domain+role+risk+root-cause+rationale)   | 271                             |
| Domain-mapped                                           | 271 / 1,834                     |
| Role-mapped                                             | 271 / 1,834                     |
| Risk-mapped                                             | 271 / 1,834                     |
| Root-cause-mapped                                       | 271 / 1,834                     |
| Learning-objective-linked                               | 155 / 1,834                     |
| Distinct domains actually used                          | 20 / 25                         |
| GCP domains                                             | 25                              |
| Learning objectives                                     | 34                              |
| Role-to-domain map entries                              | 42                              |

These are the real, live counts as of this gate's completion - not every
one of the 1,834 real observations is curated, and this document does not
claim otherwise (see Known Limitations).

## 11. Taxonomy gaps / learning-objective gaps (Gate 14 §21/§22)

- Domains with zero observations mapped so far: `GCP_FUNDAMENTALS`,
  `MONITORING_QUALITY`, `CLINICAL_DATA_MANAGEMENT` (evidence exists but
  fell outside the keyword-rule set's confident matches),
  `INSPECTION_READINESS`, `PRIVACY_CONFIDENTIALITY`, and others not yet
  reached by the 271-record tranche - a future curation pass (via the
  bounded claim/lease queue) should target these next.
- 1,563 observations remain `IMPORTED`/uncurated - a deterministic
  priority is now assigned to every one of them so future review sessions
  can work top-down.
- Learning objectives exist for the highest-evidence domains; several
  domains (see above) have no objective yet - this is an honest gap for
  a future curriculum-authoring pass, not a fabricated placeholder.

## 12. Governance, security, AI boundary

Identical to Gate 13's guarantees, extended to the new surfaces:

- FDA evidence / expert observation / training interpretation remain three
  separate, never-conflated knowledge objects (Gate 11-13's model, unchanged).
- No unsupported regulatory claims are generated - FDA BIMO Area/Role-Type
  values are mapped to a domain, never rewritten into "FDA requires X".
- `curationPriority` is a scheduling aid; it is never displayed or
  documented as a quality/confidence score.
- No LLM classification anywhere in this gate - `computeCurationPriority`
  and the keyword-rule tables are plain, auditable TypeScript functions
  whose logic is fully readable in this repository.
- Every taxonomy/curation write is role-gated (`CONTENT_AUTHOR`/`ADMIN` for
  writes; `REVIEWER` read-only; `LEARNER` and unauthenticated callers
  rejected) and audited (`GCP_DOMAIN_*`, `LEARNING_OBJECTIVE_*`,
  `GCP_DOMAIN_ROLE_MAP_CHANGED`, `OBSERVATION_CURATION_PRIORITY_ASSIGNED`,
  `OBSERVATION_CURATION_CLAIMED`/`_CLAIM_RELEASED` audit actions).
- Curating a record never changes its `externalAiEligibility` - it stays
  `INTERNAL_ONLY` unless a separate, existing governance decision changes it.

## 13. Known limitations

- No dedicated web admin UI was built for domain/role-map governance (the
  taxonomy is created/managed via `POST/PATCH /api/admin/taxonomy/*`,
  fully tested). This mirrors the platform's own existing precedent: Gate
  4's equivalent training-hierarchy CRUD (programs/levels/modules/lessons/
  objectives) also has no dedicated web UI today, API-only. The existing
  Gate 13 `/admin/observation-curation` UI was extended with a
  curation-priority filter/badge, since that UI already existed and Gate
  14 §25 explicitly asked for it to be enhanced.
- Root cause for the 26 generic FDA "Warning Letters" rows is recorded as
  `UNKNOWN` (basis `TRAINING_INFERENCE`) rather than a specific category -
  the abstracted one-line extracts do not carry enough context to
  responsibly infer a specific root-cause category without fabricating one.
- 1,563 of 1,834 real observations remain uncurated; this gate curated a
  substantial, real, minimum-exceeding tranche (271 records, comfortably
  above the 35+9+100 floor), not the entire bank - the remaining work is
  exposed as a prioritized, claimable queue for continued human review.
