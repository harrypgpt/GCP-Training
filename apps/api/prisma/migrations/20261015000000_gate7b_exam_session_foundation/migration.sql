-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_ATTEMPT_REOPENED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "exam_attempt_status" ADD VALUE IF NOT EXISTS 'PASSED';
ALTER TYPE "exam_attempt_status" ADD VALUE IF NOT EXISTS 'FAILED';

-- AlterTable
ALTER TABLE "exam_attempts" ADD COLUMN     "attempt_number" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "exam_attempt_question_options" (
    "id" UUID NOT NULL,
    "exam_attempt_question_id" UUID NOT NULL,
    "question_option_id" UUID NOT NULL,
    "presentation_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_attempt_question_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_attempt_question_options_exam_attempt_question_id_ques_key" ON "exam_attempt_question_options"("exam_attempt_question_id", "question_option_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attempt_question_options_exam_attempt_question_id_pres_key" ON "exam_attempt_question_options"("exam_attempt_question_id", "presentation_order");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attempt_questions_attempt_id_sort_order_key" ON "exam_attempt_questions"("attempt_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attempts_user_id_exam_version_id_attempt_number_key" ON "exam_attempts"("user_id", "exam_version_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "exam_attempt_question_options" ADD CONSTRAINT "exam_attempt_question_options_exam_attempt_question_id_fkey" FOREIGN KEY ("exam_attempt_question_id") REFERENCES "exam_attempt_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempt_question_options" ADD CONSTRAINT "exam_attempt_question_options_question_option_id_fkey" FOREIGN KEY ("question_option_id") REFERENCES "question_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Gate 7B concurrency guard: constraints Prisma's schema DSL cannot express
-- directly (same pattern as Stage 5's enrollment partial unique index).
-- Only one IN_PROGRESS attempt per (user, exam version) at a time - this is
-- the authoritative source of truth for "no duplicate active attempt", not
-- application-level check-then-insert. A concurrent second INSERT violates
-- this index and the service layer catches it and returns the existing
-- attempt instead (see LearnerExamAttemptService).
CREATE UNIQUE INDEX "exam_attempts_one_in_progress_per_user_version"
    ON "exam_attempts"("user_id", "exam_version_id")
    WHERE "status" = 'IN_PROGRESS';

-- Sanity CHECK constraints.
ALTER TABLE "exam_attempts"
    ADD CONSTRAINT "exam_attempts_attempt_number_positive_chk" CHECK ("attempt_number" > 0);
ALTER TABLE "exam_attempts"
    ADD CONSTRAINT "exam_attempts_expires_after_started_chk"
    CHECK ("expires_at" IS NULL OR "expires_at" > "started_at");
ALTER TABLE "exam_attempt_questions"
    ADD CONSTRAINT "exam_attempt_questions_sort_order_non_negative_chk" CHECK ("sort_order" >= 0);
ALTER TABLE "exam_attempt_question_options"
    ADD CONSTRAINT "exam_attempt_question_options_presentation_order_non_negative_chk"
    CHECK ("presentation_order" >= 0);

