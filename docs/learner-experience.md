# Learner Experience & Frontend (Gate 9)

Gate 9 is a UI/UX and product-polish gate over the learner-facing frontend
built in earlier gates. It does not change exam scoring, certificate
eligibility, training eligibility, question correctness, or any backend
authorization rule - the server remains authoritative for all of those. Two
small, additive, read-only backend endpoints were added (see "Exam
discovery" below); everything else is presentation.

## Learner navigation

`AppShell` (`apps/web/src/components/learner/app-shell.tsx`) provides the
persistent chrome for every authenticated learner page: **Dashboard /
Training / Certificates / Profile**. Only routes that actually exist are
linked - there is no admin-console link here, and no placeholder nav item.
Page-level `Breadcrumbs` (`components/ui/breadcrumbs.tsx`) supplement this on
nested training pages (program → module → lesson) so a learner always knows
where they are in the hierarchy; the current page is always the unlinked,
`aria-current="page"` item.

The exam-taking screen (`ExamShell`) deliberately does **not** use
`AppShell`: no site navigation during a live exam, only an explicit "Exit
exam" link - this was already Gate 7C's design and is unchanged.

## Dashboard behavior

`apps/web/src/app/dashboard/page.tsx` renders exactly what
`GET /api/learner/dashboard` returns: active training program/level, overall
progress, module counts, current module/lesson, and (if more than one) every
other enrollment. Nothing here is computed client-side.

**Exam/certificate status** (`ExamStatusSection`,
`components/learner/exam-status-section.tsx`) was the one piece of this flow
that was previously unreachable from any UI at all - `startExam` existed on
the backend since Gate 7B, but no page ever linked to it, and the dashboard's
own copy claimed the exam "will be available in a future release" even
though Gates 7/8 had long since shipped it. This section now shows, only once
the server's own `examEligible` flag is true:

- **Not yet available** - informational text only, no dead button, when no
  exam has been activated for the level yet.
- **Available, no attempt yet** - a "Start examination" action.
- **An attempt is in progress** - "Resume examination", linking straight
  into the existing Gate 7C exam-taking page.
- **A terminal attempt exists** (SUBMITTED/PASSED/FAILED/EXPIRED/ABANDONED)
  - its status badge (text-labelled, never color-only) plus a "View result"
    link into the existing Gate 7E result panel.
  - if a certificate already exists for that program/level, a "View
    certificate" link alongside it.

Every one of those states is read from the server; starting an exam calls
the unmodified `startExam` endpoint, which alone re-validates every
eligibility rule (profile complete, training complete, max attempts, one
in-progress attempt platform-wide) - a rejection (e.g. max attempts already
used) simply surfaces as a plain error message here, never a client-side
prediction of whether it would happen.

### Exam discovery endpoints (new, additive, read-only)

Two endpoints were added specifically to make the above possible, since nothing
in the existing API let a learner discover "the exam for my level" or "my own
past attempts" without already knowing a raw `examId`/`attemptId`:

- `GET /api/learner/exams/current?levelId=` - resolves whether an ACTIVE exam
  version exists for one of the caller's own **ACTIVE enrollments**, and if
  so its `examId`/`examVersionId`/title/question count/pass percentage. Scoped
  to the caller's own enrollment; a level the caller isn't enrolled in reports
  `available: false` rather than leaking whether an exam exists.
- `GET /api/learner/exams/attempts?levelId=` - lists the caller's own
  `ExamAttempt` rows for that level, newest first, using the exact same
  summary shape `getAttempt` already returns.

Neither endpoint decides eligibility, computes a score, or exposes an answer
key - they are pure lookups over data `startExam`/`getResult` already expose
elsewhere. `startExam` itself is completely unmodified.

## Training / lesson experience

Program → module → lesson pages (`apps/web/src/app/training/**`) are
unchanged in their data flow: sequential module/lesson state
(LOCKED/AVAILABLE/IN_PROGRESS/COMPLETED, NOT_STARTED/IN_PROGRESS/COMPLETED)
comes entirely from `TrainingStateComputer` via the existing learner API - no
progression rule was touched. Lesson completion still calls the existing
`POST .../progress/lessons/:id/complete` endpoint; the UI never marks a
lesson complete only in local state.

Case-study presentation (`CaseStudyCard`) was already scoped to
learner-safe fields only (context/scenario/observation/domain/risk/expected
action) - no admin/reviewer/AI metadata, no answer key - and needed no
change.

## Exam / result / certificate UI

Gate 7C/7D/7E's exam-taking, submission, and result UI, and Gate 8's
certificate UI, are presentation-complete from earlier gates and were not
restructured. `ExamResultPanel` renders exactly the server's PENDING/
FINALIZED result; the certificate detail page renders exactly the issued
`Certificate` row, including the QR code pointing only at the public
verification URL, and the existing accreditation-boundary disclaimer.

## Loading / error / empty states

A shared `Skeleton`/`SkeletonPage` (`components/ui/skeleton.tsx`) replaces
plain "Loading…" text across the dashboard, training catalog, program,
module, lesson, certificates, and profile pages - always announced via
`role="status" aria-live="polite"`, never a blank screen.

A shared `ErrorState` (`components/learner/error-state.tsx`) replaces ad hoc
error rendering on those same pages: `role="alert"`, the caller-supplied
learner-safe message only (never a raw stack trace or database error), and a
"Try again" action wherever a retry is meaningful. `EmptyState` remains the
distinct, separate component for a genuine "nothing here yet" outcome (no
certificates yet, no published lessons yet) - the two are never conflated.

## Accessibility

No color-only state communication anywhere touched by this gate: every
status (Locked/Available/Completed/Passed/Not passed/Active/Expired/Revoked)
is carried by its label text, with tone as a secondary, non-exclusive signal
(this was already the case via `stateDisplay`/`Badge` from earlier gates).
New components follow the same rule: `Skeleton` is `aria-hidden` with a
sibling `sr-only` label; `ErrorState` uses `role="alert"`; `Breadcrumbs` uses
`aria-current="page"` on the current item and a real `<nav aria-label>`.
`prefers-reduced-motion` (already global in `globals.css`) applies to the new
skeleton pulse automatically.

## Frontend security/privacy boundary (reviewed, unchanged)

The exam discovery endpoints were checked against the same boundary every
other learner-facing payload in this codebase respects: no
`correctOptionId`, `isCorrect`, or answer key in `CurrentExamView` or the
attempt summary list; no other learner's data (both endpoints are scoped to
the caller's own `userId`); no internal database ids beyond what the
learner already legitimately needs to navigate (`examId`/`examVersionId`/
`attemptId`, all of which existing Gate 7B/7C endpoints already returned to
the same caller).
