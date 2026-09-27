-- CreateEnum
CREATE TYPE "exam_version_status" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_UPDATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_VERSION_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_BLUEPRINT_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_BLUEPRINT_UPDATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_BLUEPRINT_VALIDATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_ACTIVATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_DEACTIVATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXAM_ARCHIVED';

-- DropForeignKey
ALTER TABLE "exam_attempts" DROP CONSTRAINT "exam_attempts_blueprint_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_blueprints" DROP CONSTRAINT "exam_blueprints_level_id_fkey";

-- DropIndex
DROP INDEX "exam_attempts_blueprint_id_idx";

-- DropIndex
DROP INDEX "exam_blueprints_level_id_idx";

-- DropIndex
DROP INDEX "exam_blueprints_status_idx";

-- AlterTable
ALTER TABLE "exam_attempts" DROP COLUMN "blueprint_id",
ADD COLUMN     "exam_version_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "exam_blueprint_rules" DROP COLUMN "rule_type",
DROP COLUMN "target_count",
DROP COLUMN "target_percent",
ADD COLUMN     "case_study_required" BOOLEAN,
ADD COLUMN     "exact_count" INTEGER,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "learning_objective_id" UUID,
ADD COLUMN     "level_id" UUID,
ADD COLUMN     "maximum_count" INTEGER,
ADD COLUMN     "minimum_count" INTEGER,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "professional_role_id" UUID,
ADD COLUMN     "source_required" BOOLEAN;

-- AlterTable
ALTER TABLE "exam_blueprints" DROP COLUMN "description",
DROP COLUMN "is_default",
DROP COLUMN "level_id",
DROP COLUMN "max_attempts",
DROP COLUMN "name",
DROP COLUMN "passing_score_percent",
DROP COLUMN "status",
DROP COLUMN "time_limit_minutes",
DROP COLUMN "total_questions",
DROP COLUMN "version",
ADD COLUMN     "exam_version_id" UUID NOT NULL,
ADD COLUMN     "notes" TEXT;

-- DropEnum
DROP TYPE "blueprint_rule_type";

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "training_program_id" UUID NOT NULL,
    "active_version_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_versions" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "exam_version_status" NOT NULL DEFAULT 'DRAFT',
    "level_id" UUID NOT NULL,
    "question_count" INTEGER NOT NULL DEFAULT 20,
    "marks_per_question" DECIMAL(6,2) NOT NULL DEFAULT 5,
    "total_marks" INTEGER NOT NULL DEFAULT 100,
    "pass_percentage" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "duration_minutes" INTEGER,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "activated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exams_code_key" ON "exams"("code");

-- CreateIndex
CREATE UNIQUE INDEX "exams_active_version_id_key" ON "exams"("active_version_id");

-- CreateIndex
CREATE INDEX "exams_training_program_id_idx" ON "exams"("training_program_id");

-- CreateIndex
CREATE INDEX "exam_versions_status_idx" ON "exam_versions"("status");

-- CreateIndex
CREATE INDEX "exam_versions_level_id_idx" ON "exam_versions"("level_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_versions_exam_id_version_number_key" ON "exam_versions"("exam_id", "version_number");

-- CreateIndex
CREATE INDEX "exam_attempts_exam_version_id_idx" ON "exam_attempts"("exam_version_id");

-- CreateIndex
CREATE INDEX "exam_blueprint_rules_is_active_idx" ON "exam_blueprint_rules"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "exam_blueprints_exam_version_id_key" ON "exam_blueprints"("exam_version_id");

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_training_program_id_fkey" FOREIGN KEY ("training_program_id") REFERENCES "training_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "exam_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_versions" ADD CONSTRAINT "exam_versions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_versions" ADD CONSTRAINT "exam_versions_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "training_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_versions" ADD CONSTRAINT "exam_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_blueprints" ADD CONSTRAINT "exam_blueprints_exam_version_id_fkey" FOREIGN KEY ("exam_version_id") REFERENCES "exam_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_blueprint_rules" ADD CONSTRAINT "exam_blueprint_rules_professional_role_id_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_blueprint_rules" ADD CONSTRAINT "exam_blueprint_rules_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "training_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_blueprint_rules" ADD CONSTRAINT "exam_blueprint_rules_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_version_id_fkey" FOREIGN KEY ("exam_version_id") REFERENCES "exam_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

