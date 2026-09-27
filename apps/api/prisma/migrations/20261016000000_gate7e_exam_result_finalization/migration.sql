-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_EVALUATED';

-- AlterTable
-- Set exactly once, by Gate 7E, at the moment SUBMITTED -> PASSED/FAILED
-- finalizes. Non-null is equivalent to "result is FINALIZED" - there is no
-- separate result_status column (status + evaluated_at already encode
-- PENDING vs FINALIZED unambiguously).
ALTER TABLE "exam_attempts" ADD COLUMN "evaluated_at" TIMESTAMPTZ(6);
