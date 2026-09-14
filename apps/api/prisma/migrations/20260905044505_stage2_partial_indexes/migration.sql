-- Stage 2 hardening: constraints Prisma's schema DSL cannot express directly.
-- These are additive and replayed with the migration history, so
-- `prisma migrate status` stays clean (see the same pattern in the Stage 1
-- initial migration).

-- Only one default exam blueprint per training level.
CREATE UNIQUE INDEX "exam_blueprints_one_default_per_level"
    ON "exam_blueprints"("level_id")
    WHERE "is_default" = true;

-- Only one in-progress exam attempt per learner at a time (exam-integrity:
-- "Prevention of duplicate active attempts").
CREATE UNIQUE INDEX "exam_attempts_one_active_per_user"
    ON "exam_attempts"("user_id")
    WHERE "status" = 'IN_PROGRESS';

-- Sanity CHECK constraints on numeric/percentage fields.
ALTER TABLE "exam_blueprints"
    ADD CONSTRAINT "exam_blueprints_total_questions_positive_chk" CHECK ("total_questions" > 0);
ALTER TABLE "exam_blueprints"
    ADD CONSTRAINT "exam_blueprints_passing_score_range_chk"
    CHECK ("passing_score_percent" >= 0 AND "passing_score_percent" <= 100);
ALTER TABLE "exam_blueprints"
    ADD CONSTRAINT "exam_blueprints_time_limit_positive_chk"
    CHECK ("time_limit_minutes" IS NULL OR "time_limit_minutes" > 0);
ALTER TABLE "exam_blueprints"
    ADD CONSTRAINT "exam_blueprints_max_attempts_positive_chk"
    CHECK ("max_attempts" IS NULL OR "max_attempts" > 0);

ALTER TABLE "exam_blueprint_rules"
    ADD CONSTRAINT "exam_blueprint_rules_target_percent_range_chk"
    CHECK ("target_percent" IS NULL OR ("target_percent" >= 0 AND "target_percent" <= 100));
ALTER TABLE "exam_blueprint_rules"
    ADD CONSTRAINT "exam_blueprint_rules_target_count_positive_chk"
    CHECK ("target_count" IS NULL OR "target_count" > 0);
ALTER TABLE "exam_blueprint_rules"
    ADD CONSTRAINT "exam_blueprint_rules_has_target_chk"
    CHECK ("target_count" IS NOT NULL OR "target_percent" IS NOT NULL);

ALTER TABLE "exam_attempts"
    ADD CONSTRAINT "exam_attempts_total_questions_positive_chk" CHECK ("total_questions" > 0);
ALTER TABLE "exam_attempts"
    ADD CONSTRAINT "exam_attempts_score_range_chk"
    CHECK ("score_percent" IS NULL OR ("score_percent" >= 0 AND "score_percent" <= 100));
ALTER TABLE "exam_attempts"
    ADD CONSTRAINT "exam_attempts_correct_count_range_chk"
    CHECK ("correct_count" IS NULL OR ("correct_count" >= 0 AND "correct_count" <= "total_questions"));

ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_score_range_chk"
    CHECK ("score_percent" >= 0 AND "score_percent" <= 100);
ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_expiry_after_issue_chk" CHECK ("expiry_date" > "issue_date");

-- Non-blank business keys.
ALTER TABLE "case_studies"
    ADD CONSTRAINT "case_studies_case_code_not_blank_chk" CHECK (length(btrim("case_code")) > 0);
ALTER TABLE "questions"
    ADD CONSTRAINT "questions_code_not_blank_chk" CHECK (length(btrim("code")) > 0);
ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_number_not_blank_chk" CHECK (length(btrim("certificate_number")) > 0);
