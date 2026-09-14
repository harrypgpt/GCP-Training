-- Stage 6: question bank (Question/QuestionVersion split for real
-- versioning), question options moved under a version, case-study links,
-- duplicate-flag foundation, and the exam_attempt_questions FK repointed at
-- the specific version served (for reproducible historical records).
--
-- Hand-reordered from the raw `prisma migrate diff` output: the generator
-- placed the question_type enum swap before the old `questions.type` column
-- (which used the old enum) was dropped, which fails with "cannot drop type
-- ... because other objects depend on it". Dropping the old columns first,
-- then swapping the enum, then creating the new tables against the final
-- enum name, is the correct order for this migration to actually apply.

-- CreateEnum
-- NOTE: an earlier manual dry-run of this migration (before the ordering fix
-- below was applied) already committed this CREATE TYPE and the audit_action
-- ADD VALUE statements directly against the dev database outside Prisma's
-- migration tracking. They are additive/idempotent in effect (the enum and
-- values now match schema.prisma exactly), so this migration does not repeat
-- them — only the statements that had NOT yet taken effect remain below.
-- A fresh database applying this migration for the first time still needs
-- them, so they are also present, guarded, via DO blocks.
DO $$ BEGIN
    CREATE TYPE "duplicate_match_type" AS ENUM ('EXACT_STEM', 'DUPLICATE_OPTION_SET');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- `ADD VALUE IF NOT EXISTS` (PG12+) is idempotent on its own and, unlike
-- CREATE TYPE, cannot be wrapped in a DO block at all (Postgres forbids
-- ALTER TYPE ... ADD VALUE inside a function/procedure/DO body).
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'QUESTION_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'QUESTION_UPDATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'QUESTION_SUBMITTED_FOR_REVIEW';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'QUESTION_REJECTED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'QUESTION_PUBLISHED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'QUESTION_ARCHIVED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'QUESTION_VERSION_CREATED';

-- DropForeignKey (old shape: Question held everything directly)
ALTER TABLE "exam_attempt_questions" DROP CONSTRAINT "exam_attempt_questions_question_id_fkey";
ALTER TABLE "question_options" DROP CONSTRAINT "question_options_question_id_fkey";
ALTER TABLE "questions" DROP CONSTRAINT "questions_case_study_id_fkey";
ALTER TABLE "questions" DROP CONSTRAINT "questions_created_by_id_fkey";
ALTER TABLE "questions" DROP CONSTRAINT "questions_domain_id_fkey";
ALTER TABLE "questions" DROP CONSTRAINT "questions_learning_objective_id_fkey";
ALTER TABLE "questions" DROP CONSTRAINT "questions_level_id_fkey";
ALTER TABLE "questions" DROP CONSTRAINT "questions_professional_role_id_fkey";
ALTER TABLE "questions" DROP CONSTRAINT "questions_source_id_fkey";

-- DropIndex
DROP INDEX "exam_attempt_questions_attempt_id_question_id_key";
DROP INDEX "exam_attempt_questions_question_id_idx";
DROP INDEX "question_options_question_id_is_correct_idx";
DROP INDEX "question_options_question_id_label_key";
DROP INDEX "questions_difficulty_idx";
DROP INDEX "questions_domain_id_idx";
DROP INDEX "questions_is_active_idx";
DROP INDEX "questions_level_id_idx";
DROP INDEX "questions_review_status_idx";
DROP INDEX "questions_type_idx";

-- AlterTable: drop the old direct columns (including the "type" column that
-- used the old enum — this must happen BEFORE the enum swap below, so
-- nothing still depends on the old enum type by the time it is dropped).
ALTER TABLE "exam_attempt_questions" DROP COLUMN "question_id",
ADD COLUMN     "question_version_id" UUID NOT NULL;

ALTER TABLE "question_options" DROP COLUMN "question_id",
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "question_version_id" UUID NOT NULL;

ALTER TABLE "questions" DROP COLUMN "case_study_id",
DROP COLUMN "created_by_id",
DROP COLUMN "difficulty",
DROP COLUMN "domain_id",
DROP COLUMN "explanation",
DROP COLUMN "is_active",
DROP COLUMN "learning_objective_id",
DROP COLUMN "level_id",
DROP COLUMN "professional_role_id",
DROP COLUMN "review_status",
DROP COLUMN "source_id",
DROP COLUMN "stem",
DROP COLUMN "type",
DROP COLUMN "version",
ADD COLUMN     "current_published_version_id" UUID;

-- AlterEnum: rename SEQUENCE_ORDERING -> SEQUENCE. Nothing references the
-- old enum type by this point, so the swap-and-drop is safe. No explicit
-- BEGIN/COMMIT here — this whole file already runs inside one transaction
-- (via `prisma migrate deploy`); a nested BEGIN previously caused the
-- statement-after-error cascade ("current transaction is aborted").
CREATE TYPE "question_type_new" AS ENUM ('KNOWLEDGE', 'APPLICATION', 'SCENARIO', 'CASE_STUDY', 'REASONING', 'REGULATORY_INTERPRETATION', 'INVESTIGATOR_DECISION', 'CRA_DECISION', 'SPONSOR_DECISION', 'RISK_PRIORITIZATION', 'SEQUENCE', 'EVIDENCE_ASSESSMENT');
ALTER TABLE "exam_blueprint_rules" ALTER COLUMN "question_type" TYPE "question_type_new" USING ("question_type"::text::"question_type_new");
ALTER TYPE "question_type" RENAME TO "question_type_old";
ALTER TYPE "question_type_new" RENAME TO "question_type";
DROP TYPE "question_type_old";

-- CreateTable
CREATE TABLE "question_versions" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "type" "question_type" NOT NULL,
    "stem" TEXT NOT NULL,
    "instructions" TEXT,
    "explanation" TEXT,
    "rationale" TEXT,
    "difficulty" "difficulty_level" NOT NULL DEFAULT 'MEDIUM',
    "level_id" UUID,
    "domain_id" UUID,
    "professional_role_id" UUID,
    "learning_objective_id" UUID,
    "observation_id" UUID,
    "source_id" UUID,
    "source_section" TEXT,
    "review_status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "author_id" UUID,
    "reviewer_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "question_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_case_study_links" (
    "question_version_id" UUID NOT NULL,
    "case_study_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_case_study_links_pkey" PRIMARY KEY ("question_version_id","case_study_id")
);

-- CreateTable
CREATE TABLE "question_duplicate_flags" (
    "id" UUID NOT NULL,
    "version_a_id" UUID NOT NULL,
    "version_b_id" UUID NOT NULL,
    "match_type" "duplicate_match_type" NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_id" UUID,
    "resolution_note" TEXT,

    CONSTRAINT "question_duplicate_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "question_versions_review_status_idx" ON "question_versions"("review_status");
CREATE INDEX "question_versions_is_active_idx" ON "question_versions"("is_active");
CREATE INDEX "question_versions_type_idx" ON "question_versions"("type");
CREATE INDEX "question_versions_domain_id_idx" ON "question_versions"("domain_id");
CREATE INDEX "question_versions_level_id_idx" ON "question_versions"("level_id");
CREATE INDEX "question_versions_difficulty_idx" ON "question_versions"("difficulty");
CREATE INDEX "question_versions_professional_role_id_idx" ON "question_versions"("professional_role_id");
CREATE INDEX "question_versions_learning_objective_id_idx" ON "question_versions"("learning_objective_id");
CREATE INDEX "question_versions_observation_id_idx" ON "question_versions"("observation_id");
CREATE UNIQUE INDEX "question_versions_question_id_version_number_key" ON "question_versions"("question_id", "version_number");

CREATE INDEX "question_case_study_links_case_study_id_idx" ON "question_case_study_links"("case_study_id");

CREATE INDEX "question_duplicate_flags_version_b_id_idx" ON "question_duplicate_flags"("version_b_id");
CREATE UNIQUE INDEX "question_duplicate_flags_version_a_id_version_b_id_match_ty_key" ON "question_duplicate_flags"("version_a_id", "version_b_id", "match_type");

CREATE INDEX "exam_attempt_questions_question_version_id_idx" ON "exam_attempt_questions"("question_version_id");
CREATE UNIQUE INDEX "exam_attempt_questions_attempt_id_question_version_id_key" ON "exam_attempt_questions"("attempt_id", "question_version_id");

CREATE INDEX "question_options_question_version_id_is_correct_idx" ON "question_options"("question_version_id", "is_correct");
CREATE UNIQUE INDEX "question_options_question_version_id_label_key" ON "question_options"("question_version_id", "label");

CREATE UNIQUE INDEX "questions_current_published_version_id_key" ON "questions"("current_published_version_id");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_current_published_version_id_fkey" FOREIGN KEY ("current_published_version_id") REFERENCES "question_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "training_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_professional_role_id_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "question_case_study_links" ADD CONSTRAINT "question_case_study_links_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_case_study_links" ADD CONSTRAINT "question_case_study_links_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_duplicate_flags" ADD CONSTRAINT "question_duplicate_flags_version_a_id_fkey" FOREIGN KEY ("version_a_id") REFERENCES "question_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_duplicate_flags" ADD CONSTRAINT "question_duplicate_flags_version_b_id_fkey" FOREIGN KEY ("version_b_id") REFERENCES "question_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_duplicate_flags" ADD CONSTRAINT "question_duplicate_flags_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "exam_attempt_questions" ADD CONSTRAINT "exam_attempt_questions_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
