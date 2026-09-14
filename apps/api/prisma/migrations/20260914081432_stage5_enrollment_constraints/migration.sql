-- Stage 5 hardening: constraints Prisma's schema DSL cannot express directly.
-- Additive, replayed with the migration history (same pattern as Stages 1-4).

-- Only one ACTIVE enrollment per learner+program+level at a time — the
-- "prevent duplicate active enrollment" requirement. A completed/cancelled/
-- expired enrollment does not block a new (retake) cycle.
CREATE UNIQUE INDEX "enrollments_one_active_per_user_program_level"
    ON "enrollments"("user_id", "program_id", "level_id")
    WHERE "status" = 'ACTIVE';

-- Sanity CHECK constraints.
ALTER TABLE "enrollments"
    ADD CONSTRAINT "enrollments_progress_range_chk"
    CHECK ("overall_progress_percent" >= 0 AND "overall_progress_percent" <= 100);
ALTER TABLE "enrollments"
    ADD CONSTRAINT "enrollments_cycle_positive_chk" CHECK ("cycle_number" > 0);
ALTER TABLE "enrollments"
    ADD CONSTRAINT "enrollments_completed_after_enrolled_chk"
    CHECK ("completed_at" IS NULL OR "completed_at" >= "enrolled_at");
ALTER TABLE "enrollments"
    ADD CONSTRAINT "enrollments_started_after_enrolled_chk"
    CHECK ("started_at" IS NULL OR "started_at" >= "enrolled_at");

ALTER TABLE "learner_profiles"
    ADD CONSTRAINT "learner_profiles_years_experience_range_chk"
    CHECK ("years_of_experience" IS NULL OR ("years_of_experience" >= 0 AND "years_of_experience" <= 80));
