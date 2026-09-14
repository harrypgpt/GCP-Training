/*
  Warnings:

  - You are about to drop the column `role` on the `users` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "content_status" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "difficulty_level" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'EXPERT');

-- CreateEnum
CREATE TYPE "risk_category" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('REGULATION', 'GUIDANCE', 'LITERATURE', 'WHITE_PAPER', 'PROPRIETARY', 'OBSERVATION', 'OTHER');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('KNOWLEDGE', 'APPLICATION', 'SCENARIO', 'CASE_STUDY', 'REASONING', 'REGULATORY_INTERPRETATION', 'INVESTIGATOR_DECISION', 'CRA_DECISION', 'SPONSOR_DECISION', 'RISK_PRIORITIZATION', 'SEQUENCE_ORDERING', 'EVIDENCE_ASSESSMENT');

-- CreateEnum
CREATE TYPE "exam_attempt_status" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "blueprint_rule_type" AS ENUM ('DOMAIN_DISTRIBUTION', 'DIFFICULTY_DISTRIBUTION', 'QUESTION_TYPE_DISTRIBUTION', 'CASE_STUDY_PROPORTION');

-- CreateEnum
CREATE TYPE "certificate_status" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "users" DROP COLUMN "role";

-- DropEnum
DROP TYPE "user_role";

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_role_assignments" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by_id" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "gcp_domains" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gcp_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "professional_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_programs" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "training_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_levels" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "training_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_objectives" (
    "id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "learning_objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "type" "source_type" NOT NULL,
    "title" TEXT NOT NULL,
    "citation" TEXT,
    "url" TEXT,
    "published_on" DATE,
    "retrieved_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_studies" (
    "id" UUID NOT NULL,
    "case_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "observation" TEXT NOT NULL,
    "context" TEXT,
    "domain_id" UUID,
    "professional_role_id" UUID,
    "risk_category" "risk_category",
    "root_cause" TEXT,
    "expected_action" TEXT,
    "learning_objective_id" UUID,
    "difficulty" "difficulty_level" NOT NULL DEFAULT 'MEDIUM',
    "source_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "review_status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "case_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_study_tags" (
    "case_study_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "case_study_tags_pkey" PRIMARY KEY ("case_study_id","tag_id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" UUID NOT NULL,
    "observation_code" TEXT NOT NULL,
    "case_study_id" UUID,
    "domain_id" UUID,
    "risk_category" "risk_category",
    "description" TEXT NOT NULL,
    "source_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "question_type" NOT NULL,
    "stem" TEXT NOT NULL,
    "explanation" TEXT,
    "domain_id" UUID,
    "level_id" UUID,
    "professional_role_id" UUID,
    "learning_objective_id" UUID,
    "case_study_id" UUID,
    "source_id" UUID,
    "difficulty" "difficulty_level" NOT NULL DEFAULT 'MEDIUM',
    "version" INTEGER NOT NULL DEFAULT 1,
    "review_status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "explanation" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_blueprints" (
    "id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "total_questions" INTEGER NOT NULL DEFAULT 20,
    "passing_score_percent" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "time_limit_minutes" INTEGER,
    "max_attempts" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_blueprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_blueprint_rules" (
    "id" UUID NOT NULL,
    "blueprint_id" UUID NOT NULL,
    "rule_type" "blueprint_rule_type" NOT NULL,
    "domain_id" UUID,
    "difficulty" "difficulty_level",
    "question_type" "question_type",
    "target_count" INTEGER,
    "target_percent" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_blueprint_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "blueprint_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "status" "exam_attempt_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "total_questions" INTEGER NOT NULL,
    "correct_count" INTEGER,
    "score_percent" DECIMAL(5,2),
    "passed" BOOLEAN,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_attempt_questions" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "selected_option_id" UUID,
    "is_correct" BOOLEAN,
    "answered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_attempt_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "certificate_number" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "exam_attempt_id" UUID NOT NULL,
    "score_percent" DECIMAL(5,2) NOT NULL,
    "issue_date" DATE NOT NULL,
    "expiry_date" DATE NOT NULL,
    "status" "certificate_status" NOT NULL DEFAULT 'ACTIVE',
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_id" UUID,
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_role_assignments_role_id_idx" ON "user_role_assignments"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "gcp_domains_code_key" ON "gcp_domains"("code");

-- CreateIndex
CREATE UNIQUE INDEX "professional_roles_code_key" ON "professional_roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "training_programs_slug_key" ON "training_programs"("slug");

-- CreateIndex
CREATE INDEX "training_programs_status_idx" ON "training_programs"("status");

-- CreateIndex
CREATE INDEX "training_levels_status_idx" ON "training_levels"("status");

-- CreateIndex
CREATE UNIQUE INDEX "training_levels_program_id_code_key" ON "training_levels"("program_id", "code");

-- CreateIndex
CREATE INDEX "modules_status_idx" ON "modules"("status");

-- CreateIndex
CREATE UNIQUE INDEX "modules_level_id_slug_key" ON "modules"("level_id", "slug");

-- CreateIndex
CREATE INDEX "lessons_status_idx" ON "lessons"("status");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_module_id_slug_key" ON "lessons"("module_id", "slug");

-- CreateIndex
CREATE INDEX "learning_objectives_lesson_id_idx" ON "learning_objectives"("lesson_id");

-- CreateIndex
CREATE INDEX "sources_type_idx" ON "sources"("type");

-- CreateIndex
CREATE UNIQUE INDEX "case_studies_case_code_key" ON "case_studies"("case_code");

-- CreateIndex
CREATE INDEX "case_studies_review_status_idx" ON "case_studies"("review_status");

-- CreateIndex
CREATE INDEX "case_studies_is_active_idx" ON "case_studies"("is_active");

-- CreateIndex
CREATE INDEX "case_studies_domain_id_idx" ON "case_studies"("domain_id");

-- CreateIndex
CREATE INDEX "case_studies_risk_category_idx" ON "case_studies"("risk_category");

-- CreateIndex
CREATE INDEX "case_study_tags_tag_id_idx" ON "case_study_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "observations_observation_code_key" ON "observations"("observation_code");

-- CreateIndex
CREATE INDEX "observations_is_active_idx" ON "observations"("is_active");

-- CreateIndex
CREATE INDEX "observations_case_study_id_idx" ON "observations"("case_study_id");

-- CreateIndex
CREATE INDEX "observations_domain_id_idx" ON "observations"("domain_id");

-- CreateIndex
CREATE UNIQUE INDEX "questions_code_key" ON "questions"("code");

-- CreateIndex
CREATE INDEX "questions_review_status_idx" ON "questions"("review_status");

-- CreateIndex
CREATE INDEX "questions_is_active_idx" ON "questions"("is_active");

-- CreateIndex
CREATE INDEX "questions_type_idx" ON "questions"("type");

-- CreateIndex
CREATE INDEX "questions_domain_id_idx" ON "questions"("domain_id");

-- CreateIndex
CREATE INDEX "questions_level_id_idx" ON "questions"("level_id");

-- CreateIndex
CREATE INDEX "questions_difficulty_idx" ON "questions"("difficulty");

-- CreateIndex
CREATE INDEX "question_options_question_id_is_correct_idx" ON "question_options"("question_id", "is_correct");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_id_label_key" ON "question_options"("question_id", "label");

-- CreateIndex
CREATE INDEX "exam_blueprints_level_id_idx" ON "exam_blueprints"("level_id");

-- CreateIndex
CREATE INDEX "exam_blueprints_status_idx" ON "exam_blueprints"("status");

-- CreateIndex
CREATE INDEX "exam_blueprint_rules_blueprint_id_idx" ON "exam_blueprint_rules"("blueprint_id");

-- CreateIndex
CREATE INDEX "exam_attempts_user_id_idx" ON "exam_attempts"("user_id");

-- CreateIndex
CREATE INDEX "exam_attempts_status_idx" ON "exam_attempts"("status");

-- CreateIndex
CREATE INDEX "exam_attempts_blueprint_id_idx" ON "exam_attempts"("blueprint_id");

-- CreateIndex
CREATE INDEX "exam_attempt_questions_question_id_idx" ON "exam_attempt_questions"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attempt_questions_attempt_id_question_id_key" ON "exam_attempt_questions"("attempt_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificate_number_key" ON "certificates"("certificate_number");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_exam_attempt_id_key" ON "certificates"("exam_attempt_id");

-- CreateIndex
CREATE INDEX "certificates_user_id_idx" ON "certificates"("user_id");

-- CreateIndex
CREATE INDEX "certificates_status_idx" ON "certificates"("status");

-- CreateIndex
CREATE INDEX "certificates_expiry_date_idx" ON "certificates"("expiry_date");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_programs" ADD CONSTRAINT "training_programs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_levels" ADD CONSTRAINT "training_levels_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "training_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_levels" ADD CONSTRAINT "training_levels_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "training_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_objectives" ADD CONSTRAINT "learning_objectives_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_professional_role_id_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_tags" ADD CONSTRAINT "case_study_tags_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_tags" ADD CONSTRAINT "case_study_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "training_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_professional_role_id_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_blueprints" ADD CONSTRAINT "exam_blueprints_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "training_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_blueprints" ADD CONSTRAINT "exam_blueprints_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_blueprint_rules" ADD CONSTRAINT "exam_blueprint_rules_blueprint_id_fkey" FOREIGN KEY ("blueprint_id") REFERENCES "exam_blueprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_blueprint_rules" ADD CONSTRAINT "exam_blueprint_rules_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_blueprint_id_fkey" FOREIGN KEY ("blueprint_id") REFERENCES "exam_blueprints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "training_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempt_questions" ADD CONSTRAINT "exam_attempt_questions_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempt_questions" ADD CONSTRAINT "exam_attempt_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempt_questions" ADD CONSTRAINT "exam_attempt_questions_selected_option_id_fkey" FOREIGN KEY ("selected_option_id") REFERENCES "question_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "training_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "training_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_exam_attempt_id_fkey" FOREIGN KEY ("exam_attempt_id") REFERENCES "exam_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
