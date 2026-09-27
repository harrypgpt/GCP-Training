# Certificate Engine (Gate 8)

Gate 8 issues a verifiable training certificate only after Gate 7E has
finalized a **PASSED** result for a learner's own exam attempt. It does not
score anything, does not touch the examination engine's data, and does not
claim any accreditation this platform has not actually been granted.

## Terminology and accreditation boundary

Certificates issued by this platform are called **"GCP Training
Certificate"** (or, in longer prose, "ICH GCP Training Certificate" -
referring to the _subject matter_ the training covers, not an
endorsement). The platform does **not** claim:

- "ICH-certified"
- "ICH accredited"
- "official ICH certificate"
- "ICH-issued certificate"

No such authorization or accreditation is documented anywhere in this
project. The certificate text itself says exactly this: _"This certificate
reflects successful completion of this platform's training and assessment.
It is not an ICH accreditation or endorsement."_ Any future decision to
seek and use real accreditation language must be made deliberately, with
supporting documentation, not introduced by wording drift in this engine.

## Critical principle: the server is the sole certificate authority

A certificate can be issued only when **all** of the following are true,
verified server-side, in `CertificatesService.issueCertificate`:

1. The caller owns the exam attempt (`{id: attemptId, userId}` - the exact
   Gate 7B/7D/7E ownership contract).
2. `ExamAttempt.status === PASSED`.
3. The Gate 7E result is internally consistent: `passed === true`,
   `scorePercent` is populated and `>= examVersion.passPercentage`, and
   `evaluatedAt` is populated.
4. The learner has authoritative training completion for that
   program/level (Gate 5's `TrainingStateComputer`, re-checked fresh - not
   assumed from exam-start time).
5. No certificate already exists for this exact attempt (the
   `examAttemptId` unique constraint is the actual authority here, not just
   an application-level check).

None of the following are ever sufficient, and none of them is even
possible to submit through the issuance request body, which has exactly
one field (`attemptId`): a frontend score, a frontend PASS display,
browser storage, a client-provided score/percentage/passed/programId/
levelId/examVersionId, a SUBMITTED (not yet evaluated) attempt, or an
attempt id the caller does not own.

## Existing architecture inspected before writing any code

- `Certificate` and `CertificateStatus` (ACTIVE/EXPIRED/REVOKED) already
  existed as Stage 2 placeholders, with **zero rows and zero writers
  anywhere** (confirmed by Gate 7E's own repository audit). Reused as the
  certificate model - no redundant table introduced.
- `TrainingStateComputer.summarize(enrollment).examEligible` (Gate 5) is
  this platform's one authoritative "has the learner completed the
  required training" signal - the exact same check Gate 7B already used to
  gate exam start. Reused, not re-derived.
- `LearnerProfile.firstName`/`lastName` (guaranteed non-null for any
  learner who ever reached PASSED, since Gate 7B's own eligibility check
  already required a complete profile before an attempt could start) is the
  display-name source.
- `TrainingProgram.title` / `TrainingLevel.name` are edited **in place** by
  the existing admin content workflow (no versioning, unlike Question/
  ExamVersion) - confirmed by reading `LevelsService.update`, which does a
  direct `prisma.trainingLevel.update({ data: { ...dto } })`. This is why
  Certificate snapshots these names rather than joining live.
- `AuditAction.CERTIFICATE_ISSUED` / `CERTIFICATE_REVOKED` already existed,
  pre-seeded and unused - reused exactly like Gate 7B reused `EXAM_STARTED`.

## Data model

`Certificate` (existing table, extended additively - see Migration below):

| Field                                                                                 | Purpose                                                                                                              |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `certificateNumber` (unique)                                                          | Public, human-shareable, printable identifier - `GCP-<year>-<8 chars>`                                               |
| `verificationCode` (unique, **new**)                                                  | Separate, higher-entropy, URL-safe token for the public verification URL/QR - kept distinct from `certificateNumber` |
| `userId`, `programId`, `levelId`, `examAttemptId` (unique), `examVersionId` (**new**) | Relational identity - `examAttemptId`'s uniqueness is the idempotency/no-duplicate-issuance guarantee                |
| `scorePercent`, `passPercentageSnapshot` (**new**)                                    | The qualifying Gate 7E result, snapshotted - never recalculated                                                      |
| `learnerNameSnapshot`, `programNameSnapshot`, `levelNameSnapshot` (**new**)           | Historical display identity - immune to later profile/content renames                                                |
| `issueDate`, `expiryDate`, `status`, `revokedAt`, `revokedById`, `revocationReason`   | Lifecycle (unchanged from the original placeholder)                                                                  |

`TrainingLevel.certificateValidityMonths` (**new**, `Int @default(12)`) -
configurable per level; every existing level defaults to 12 via the
migration's column default. No admin UI edits this yet (see Known
limitations) - the schema is ready for one.

### Why snapshot fields, not live joins

A certificate is a **historical** artifact. `scorePercent`/
`passPercentageSnapshot` avoid ever depending on a future Gate 7E
recalculation (there is none - Gate 7E never re-scores a finalized
attempt, but the certificate does not rely on that invariant holding
forever either). `learnerNameSnapshot`/`programNameSnapshot`/
`levelNameSnapshot` avoid a later profile edit or program/level rename
silently rewriting an already-issued certificate - verified by e2e tests
that rename the profile and the program _after_ issuance and confirm the
certificate (and its public verification response) are unchanged.

## Certificate number

`GCP-<year>-<8 chars>`, e.g. `GCP-2026-7F4K92QX`. Generated by
`generateCertificateNumber` (`certificate-code.util.ts`) using
`node:crypto`'s `randomInt` (a CSPRNG - never `Math.random()`), drawing
each of the 8 characters independently from a 32-symbol alphabet that
excludes visually-ambiguous characters (`0`/`O`, `1`/`I`). Not sequential -
32^8 ≈ 1.1 × 10^12 possibilities. A database `UNIQUE` constraint is the
actual authority; a collision (astronomically unlikely) triggers a bounded
retry with a freshly-generated number, never a silent overwrite.

## Verification code

A **separate** field from `certificateNumber`, generated by
`generateVerificationCode` as `randomBytes(24)` (192 bits) base64url-encoded

- URL-safe, QR-safe, and never derived from an email, a timestamp, a user
  id, or an attempt id. This is the only identifier the public verification
  endpoint and QR code ever use; the certificate's own database id and every
  other internal id are never exposed publicly.

## Certificate lifecycle

```
ISSUE → ACTIVE ──(admin REVOKE)──► REVOKED (terminal)
   │
   └─(expiryDate passes)──► reported as EXPIRED (derived at read time)
```

`REVOKED` is terminal - no reinstatement path exists or was requested.
`EXPIRED` is **never written to the database**; see Expiration below.

## Validity period

Default **12 months**, computed with proper calendar-month arithmetic
(`addCalendarMonths` in `certificate-validity.util.ts`), not `365 * 24`
hours - the two diverge across leap years, and end-of-month dates are
clamped correctly (Jan 31 + 1 month = Feb 28/29, never "Mar 3"). The
configured source is `TrainingLevel.certificateValidityMonths` (default 12) - read fresh at issuance, never hard-coded in the issuance code path
itself.

## Eligibility rules (exact checks performed)

`CertificatesService.assertResultEligible`:

- `attempt.status === PASSED` (not SUBMITTED, not IN_PROGRESS, not FAILED).
- `attempt.passed === true`.
- `attempt.scorePercent !== null` and `>= examVersion.passPercentage`.
- `attempt.evaluatedAt !== null`.

If `status === PASSED` but any other field is inconsistent, this is treated
as a genuine data-integrity problem: logged server-side (with no answer
data - just the fact that the check failed) and reported to the caller as
the same safe `CERTIFICATE_NOT_ELIGIBLE` response a normal ineligibility
would produce - never a misleading certificate, and never an internal
error message that would reveal the inconsistency to the caller.

`CertificatesService.assertTrainingComplete`:

- An `ACTIVE` `Enrollment` exists for `{userId, programId, levelId}`.
- `TrainingStateComputer.summarize(enrollment).examEligible === true`.

## Gate 7E dependency

Gate 8 never recalculates a score or re-derives pass/fail - it only reads
`ExamAttempt.status`/`passed`/`scorePercent`/`evaluatedAt`, all of which are
exclusively written by `LearnerExamScoringService` (Gate 7E). Because Gate
7E evaluates lazily (on the first `GET .../result`), an attempt that is
`SUBMITTED` but has never had its result fetched is correctly rejected as
not-yet-eligible (`CERTIFICATE_NOT_ELIGIBLE`) - Gate 8 never triggers
evaluation itself. A repository-wide audit before completion confirmed
`LearnerExamScoringService` remains the only writer of `PASSED`/`FAILED`
anywhere in the codebase.

## Issuance API

`POST /api/learner/certificates/issue` (authenticated, self-scoped).
Request body: `{ "attemptId": "uuid" }` - the only field. The server
derives every other fact.

Response (`issueCertificateResponseSchema`):

```json
{
  "certificateId": "uuid",
  "certificateNumber": "GCP-2026-7F4K92QX",
  "verificationCode": "…",
  "verificationUrl": "http://localhost:3000/verify/certificate/…",
  "issuedAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "status": "ACTIVE"
}
```

`verificationUrl` is built from `AppConfigService.publicWebUrl` (the new
`PUBLIC_WEB_URL` env var, default `http://localhost:3000` for local dev) -
never a hard-coded `localhost` in the response-building code itself.

## Issuance transaction

The read-heavy eligibility checks (ownership, PASSED/finalized, training
completion) run first as plain reads - none of them change based on a
concurrent issuance attempt, so they do not need to be inside the same
transaction as the write. The actual `Certificate` row insert is a single
atomic statement; the **database's own `examAttemptId` UNIQUE constraint**
is the final authority against duplicates, exactly mirroring Gate 7B's own
"optimistic check, then let the constraint be the real guard, catch P2002"
pattern - not reinvented, reused.

## Idempotency

If a certificate already exists for the attempt (checked via
`certificate.findUnique({ where: { examAttemptId } })`), it is returned
unchanged - no new row, no new audit event. This is the first line of
defence; the database constraint is the second, for the case where two
requests both pass that check before either has committed.

## Concurrency

Two or more simultaneous issuance requests for the same attempt: exactly
one `INSERT` succeeds; the others receive a `P2002` on `exam_attempt_id`,
at which point the service re-reads and returns the _winner's_ certificate

- every caller gets a 200 with the same certificate, never an error, never
  a duplicate. Verified by a real-Postgres e2e test firing 3 concurrent
  issuance requests and asserting exactly one certificate row and exactly one
  `CERTIFICATE_ISSUED` audit event exist afterward. The identical pattern
  protects concurrent revocation (a conditional `updateMany` guarded by
  `status: { not: REVOKED }`), also verified by a 3-way concurrent e2e test.

## Certificate immutability

Once issued, nothing ever rewrites `certificateNumber`, `verificationCode`,
`issuedAt` (`issueDate`), the `*Snapshot` fields, or `examVersionId` - the
service has no code path that updates any of them. The only mutation any
code path performs after issuance is the revoke transition
(`status/revokedAt/revokedById/revocationReason`), and only once (a second
revoke attempt is rejected as a conflict, never re-applied).

## Learner certificate APIs

- `GET /api/learner/certificates` - the caller's own certificates only.
- `GET /api/learner/certificates/:certificateId` - ownership-checked; a
  non-owned or missing id returns the same `404 CERTIFICATE_NOT_FOUND`.

## Public verification API

`GET /api/public/certificates/verify/:verificationCode` - `@Public()`
(bypasses the global JWT guard entirely), rate-limited
(`CERTIFICATE_VERIFY_THROTTLE`, 20/60s, mirroring `AUTH_THROTTLE`'s exact
pattern). The verification code alone identifies the record - never a
database id, never sequential, never enumerable.

```json
{
  "valid": true,
  "certificateNumber": "GCP-2026-7F4K92QX",
  "learnerName": "Jane Doe",
  "programName": "ICH GCP Certification Program",
  "levelName": "Foundation",
  "issuedAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "status": "ACTIVE"
}
```

No email, phone, user id, exam attempt id, internal database id, or exam
score anywhere in this shape - by construction (the schema has no such
field), not merely by convention. An invalid/nonexistent code returns the
same generic `404 CERTIFICATE_NOT_FOUND` a revoked-and-forgotten or
never-issued code would, never revealing which.

## Expiration: derived at read time, never a scheduled job

No background job changes `status` to `EXPIRED`. Every read path
(`effectiveStatus` in `CertificatesService`) computes the _effective_
status from `expiryDate` at the moment of the read: `REVOKED` stays
`REVOKED` regardless of date; otherwise, `expiryDate < now` reports
`EXPIRED` even though the stored `status` column may still say `ACTIVE`.
This was a deliberate choice consistent with "prefer read-time derivation
unless existing architecture already uses scheduled lifecycle jobs" - no
such job infrastructure exists anywhere in this codebase, and introducing
one solely for this would have been disproportionate. A public `GET` never
writes to the row it is reading, including this one - verified by a unit
test asserting `certificate.updateMany` is never called during
`verifyCertificate`.

## Learner UI

- **`/exams/attempts/[attemptId]`** (Gate 7C/7D/7E's existing route): once
  the finalized result is `PASSED`, a `CertificateIssueCta` renders inside
  the existing `ExamResultPanel` - a single "Get your certificate" button
  the learner must click (never automatic, never inferred from
  `if (passed)` alone on the client - the server is asked, and only the
  server's response determines what renders next). On success it links to
  the certificate detail page.
- **`/certificates`** - the learner's own certificate list (added to the
  main `AppShell` navigation), showing number, program, level, dates, and
  status per row.
- **`/certificates/[certificateId]`** - the full certificate presentation:
  learner name, program, level, score, certificate number, issue/expiry
  dates, a QR code, the verification URL, and a "Print certificate" button
  (a `window.print()` call plus `print:` Tailwind utility classes - no PDF
  generation subsystem was introduced, per the spec's explicit "do not
  introduce a large PDF-generation subsystem... unless required").
- **`/verify/certificate/[verificationCode]`** - the public page, no
  authentication, no site navigation, rendering only the safe verification
  fields and a factual status message ("Certificate is valid." / "...has
  expired." / "...has been revoked.").

## QR code

The project's first QR dependency: `qrcode` (browser-side
`QRCode.toDataURL`), chosen as a small, widely-used, actively maintained
library rather than a hand-rolled encoder. `CertificateQrCode` encodes
**only** the verification URL string it is given - there is no other data
available to it to encode by construction.

## Frontend/server boundary

The frontend never calculates eligibility, a score, or a certificate's
validity. `CertificateIssueCta` has no `passed`/`eligible` prop and no
`if (passed)` branch of its own - the caller (`ExamResultPanel`) decides
_whether to render it_ from the server's own result, and the button, when
clicked, only ever asks the server to decide the rest. The public
verification page renders exactly the `valid`/`status` fields the server
returned, never recomputing either - proven by a test that feeds it a
deliberately self-inconsistent payload (`status: ACTIVE, valid: false`) and
asserts the page shows the _given_ (inconsistent) values rather than
silently "fixing" them client-side.

## Audit logging

Reuses the pre-existing, previously-unused `CERTIFICATE_ISSUED` and
`CERTIFICATE_REVOKED` actions. Exactly one `CERTIFICATE_ISSUED` event per
attempt (never for an idempotent repeat, never for a request that lost the
concurrency race); exactly one `CERTIFICATE_REVOKED` event per certificate
(never for a repeated or concurrently-losing revoke attempt). Metadata is
limited to non-sensitive context (`attemptId`, `programId`/`levelId` for
issuance; `reason` for revocation) - no score, no answer data.

## Security / privacy summary

- Issuance request has exactly one field (`attemptId`) - no other field
  exists to inject a score, status, date, or code through.
- Ownership resolved via `{id, userId}` throughout - a non-owned attempt or
  certificate is indistinguishable from a nonexistent one.
- Revocation is `@Roles([UserRole.ADMIN])`-gated; no learner-facing code
  path can ever set `status = REVOKED`.
- Public verification exposes only certificate number, learner name,
  program, level, dates, and effective status - never PII beyond the
  display name already intended for public certificate verification (this
  is the platform's own explicit design: a certificate's purpose is to be
  shown to a third party, so the learner's name is intentionally public
  once a certificate exists - unlike email, phone, or any account
  identifier, which are never exposed).
- No certificate is ever deleted - revocation is the only invalidation
  mechanism, and the row remains for audit history.

## Repository audit (performed before declaring this gate complete)

- Every `Certificate` write in the repository: exactly two sites, both in
  `CertificatesService` (`create` for issuance, `updateMany` for
  revocation). No other writer exists, admin or learner.
- Every `PASSED`/`FAILED` write: unchanged from the Gate 7E audit - only
  `LearnerExamScoringService`. `CertificatesService` only ever _reads_
  `attempt.status`.
- Every certificate number / verification code generator call: only
  `CertificatesService`, via `certificate-code.util.ts`.
- No certificate deletion code path exists anywhere.
- Exactly one `@Public()` route in the certificates module (the
  verification endpoint); exactly one issuance endpoint and one revoke
  endpoint.

## Testing

**Backend unit**: `certificate-code.util.spec.ts` (8 tests - format,
non-ambiguous characters, non-sequentiality, URL-safety, entropy),
`certificate-validity.util.spec.ts` (6 tests - calendar-month arithmetic,
leap-year clamping, proof it differs from fixed-hour math),
`certificates.service.spec.ts` (30 tests - every eligibility branch,
idempotency, concurrency-race handling, derived-field control, snapshot
correctness, ownership, public verification's effective-status derivation,
revocation and its own concurrency/idempotency).

**Backend E2E** (`certificates.e2e-spec.ts`, 20 tests, real Postgres): full
issuance eligibility matrix (PASSED/FAILED/SUBMITTED-unevaluated/
IN_PROGRESS/non-owner/unauthenticated/tamper-attempt), idempotent and
3-way-concurrent issuance, learner list/detail ownership, public
verification (valid, invalid-code, post-profile-rename, post-program-rename
snapshots), revocation (admin-only, learner-forbidden, double-revoke
conflict, 3-way-concurrent revoke), and admin inspection access control.

**Frontend**: `certificate-issue-cta.test.tsx` (5), `certificates/page.test.tsx`
(5), `certificates/[certificateId]/page.test.tsx` (4),
`verify/certificate/[verificationCode]/page.test.tsx` (7) - loading/empty/
error states, ownership-error rendering, no-forbidden-field sweeps, the
no-client-side-eligibility/validity proofs, and duplicate-click prevention.
Two additional assertions were added to the existing Gate 7E
`page.test.tsx` confirming the "Get your certificate" button appears only
on a PASSED result and never on a FAILED one.

**Contract tests**: 9 new tests in `contracts.test.ts` covering the
issuance request/response, summary/detail/admin schemas, the public
verification schema's forbidden-field sweep, and the revoke request's
validation.

No browser/Playwright automation was used, for the same reasons disclosed
in every prior gate: no full-stack harness (API + Postgres + a running
Next server + seeded data + an authenticated browser session) exists in
this project. Coverage is Vitest/RTL for the UI and real-Postgres
Jest/Supertest e2e for the API, including two independent real-concurrency
tests (issuance and revocation) - a more rigorous proof of this gate's
atomicity claims than a scripted browser click-through would be.

## Known limitations

- No admin UI exists yet to edit `TrainingLevel.certificateValidityMonths`
  per level - every level uses the schema default (12 months) until one is
  built. The column and the issuance code path that reads it are both
  ready for that future UI.
- No certificate deletion or bulk export/analytics - deliberately out of
  this gate's scope.
- No email delivery - the certificate is available only through the
  authenticated learner portal, per the spec's explicit "no unrelated email
  system" instruction.
- No browser/Playwright E2E run (see Testing above).
- `Certificate.userId` uniqueness is scoped to `examAttemptId`, i.e. one
  certificate per **qualifying attempt** - a learner who passes the same
  exam again on a later attempt (a retake) would be eligible for a second,
  separate certificate. This matches the spec's stated default ("one
  certificate per passed certification attempt") and was a deliberate
  choice, not an oversight - no product requirement was found anywhere in
  the repository asking for "one certificate per learner/program/level"
  instead.
