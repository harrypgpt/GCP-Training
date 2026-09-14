-- Stage 6 hand-written constraints: the invariants Prisma's schema DSL
-- cannot express directly (sequences, partial unique indexes, CHECK
-- constraints). Mirrors the pattern established in Stage 4/5's own
-- "_constraints" migrations.

-- Stable, sequential business codes: "GCP-Q-" + zero-padded nextval.
-- A dedicated sequence (rather than MAX(code)+1) avoids a race between two
-- concurrent question-creation requests ever handing out the same code.
CREATE SEQUENCE IF NOT EXISTS "question_code_seq" START WITH 1 INCREMENT BY 1;

-- At most one option may be marked correct per question version — the
-- database-level backstop for the single-best-answer rule (Stage 6 spec
-- §6/§15), independent of whatever the service layer already checks.
CREATE UNIQUE INDEX "question_options_one_correct_per_version"
    ON "question_options"("question_version_id")
    WHERE "is_correct" = true;

ALTER TABLE "question_versions"
    ADD CONSTRAINT "question_versions_version_number_positive_chk"
    CHECK ("version_number" > 0);

ALTER TABLE "question_versions"
    ADD CONSTRAINT "question_versions_published_after_approved_chk"
    CHECK ("published_at" IS NULL OR "approved_at" IS NULL OR "published_at" >= "approved_at");

ALTER TABLE "question_versions"
    ADD CONSTRAINT "question_versions_archived_after_created_chk"
    CHECK ("archived_at" IS NULL OR "archived_at" >= "created_at");

-- A version can never be flagged as a duplicate of itself.
ALTER TABLE "question_duplicate_flags"
    ADD CONSTRAINT "question_duplicate_flags_distinct_versions_chk"
    CHECK ("version_a_id" <> "version_b_id");
