-- CreateEnum
CREATE TYPE "external_ai_eligibility" AS ENUM ('INTERNAL_ONLY', 'SAFE_FOR_EXTERNAL_AI');

-- CreateEnum
CREATE TYPE "ai_operation" AS ENUM ('CONCEPT_EXTRACTION', 'LEARNING_OBJECTIVE_GENERATION', 'QUESTION_GENERATION', 'QUESTION_VARIATION', 'QUALITY_REVIEW', 'DUPLICATE_ANALYSIS');

-- CreateEnum
CREATE TYPE "ai_run_status" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "ai_candidate_status" AS ENUM ('GENERATED', 'VALIDATION_FAILED', 'READY_FOR_REVIEW', 'IN_REVIEW', 'ACCEPTED', 'REJECTED', 'DISCARDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'AI_GENERATION_REQUESTED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'AI_GENERATION_SUCCEEDED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'AI_GENERATION_FAILED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'AI_CANDIDATE_ACCEPTED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'AI_CANDIDATE_REJECTED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'AI_CANDIDATE_CONVERTED';

-- AlterTable
ALTER TABLE "case_studies" ADD COLUMN     "external_ai_eligibility" "external_ai_eligibility" NOT NULL DEFAULT 'INTERNAL_ONLY';

-- AlterTable
ALTER TABLE "observations" ADD COLUMN     "external_ai_eligibility" "external_ai_eligibility" NOT NULL DEFAULT 'INTERNAL_ONLY';

-- CreateTable
CREATE TABLE "ai_generation_runs" (
    "id" UUID NOT NULL,
    "operation" "ai_operation" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "ai_run_status" NOT NULL DEFAULT 'PENDING',
    "initiated_by_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "prompt_template_version" TEXT NOT NULL,
    "grounding_version" TEXT NOT NULL,
    "output_schema_version" TEXT NOT NULL,
    "source_id" UUID,
    "source_section" TEXT,
    "case_study_id" UUID,
    "observation_id" UUID,
    "learning_objective_id" UUID,
    "level_id" UUID,
    "module_id" UUID,
    "professional_role_id" UUID,
    "request_params" JSONB NOT NULL DEFAULT '{}',
    "token_usage" JSONB,
    "latency_ms" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_question_candidates" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "status" "ai_candidate_status" NOT NULL DEFAULT 'GENERATED',
    "type" "question_type" NOT NULL,
    "difficulty" "difficulty_level" NOT NULL DEFAULT 'MEDIUM',
    "stem" TEXT NOT NULL,
    "instructions" TEXT,
    "explanation" TEXT,
    "rationale" TEXT,
    "level_id" UUID,
    "domain_id" UUID,
    "professional_role_id" UUID,
    "learning_objective_id" UUID,
    "source_id" UUID,
    "source_section" TEXT,
    "observation_id" UUID,
    "quality_report" JSONB NOT NULL DEFAULT '{}',
    "quality_signals" JSONB NOT NULL DEFAULT '{}',
    "reviewer_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "converted_question_id" UUID,
    "converted_question_version_id" UUID,
    "converted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_question_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_question_candidate_options" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "explanation" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_question_candidate_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_question_candidate_case_studies" (
    "candidate_id" UUID NOT NULL,
    "case_study_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_question_candidate_case_studies_pkey" PRIMARY KEY ("candidate_id","case_study_id")
);

-- CreateIndex
CREATE INDEX "ai_generation_runs_operation_idx" ON "ai_generation_runs"("operation");

-- CreateIndex
CREATE INDEX "ai_generation_runs_status_idx" ON "ai_generation_runs"("status");

-- CreateIndex
CREATE INDEX "ai_generation_runs_initiated_by_id_idx" ON "ai_generation_runs"("initiated_by_id");

-- CreateIndex
CREATE INDEX "ai_generation_runs_created_at_idx" ON "ai_generation_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_question_candidates_converted_question_id_key" ON "ai_question_candidates"("converted_question_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_question_candidates_converted_question_version_id_key" ON "ai_question_candidates"("converted_question_version_id");

-- CreateIndex
CREATE INDEX "ai_question_candidates_status_idx" ON "ai_question_candidates"("status");

-- CreateIndex
CREATE INDEX "ai_question_candidates_run_id_idx" ON "ai_question_candidates"("run_id");

-- CreateIndex
CREATE INDEX "ai_question_candidates_level_id_idx" ON "ai_question_candidates"("level_id");

-- CreateIndex
CREATE INDEX "ai_question_candidates_domain_id_idx" ON "ai_question_candidates"("domain_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_question_candidate_options_candidate_id_label_key" ON "ai_question_candidate_options"("candidate_id", "label");

-- CreateIndex
CREATE INDEX "ai_question_candidate_case_studies_case_study_id_idx" ON "ai_question_candidate_case_studies"("case_study_id");

-- AddForeignKey
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "training_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_professional_role_id_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_generation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "training_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_professional_role_id_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_converted_question_id_fkey" FOREIGN KEY ("converted_question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_converted_question_version_id_fkey" FOREIGN KEY ("converted_question_version_id") REFERENCES "question_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidate_options" ADD CONSTRAINT "ai_question_candidate_options_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "ai_question_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidate_case_studies" ADD CONSTRAINT "ai_question_candidate_case_studies_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "ai_question_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidate_case_studies" ADD CONSTRAINT "ai_question_candidate_case_studies_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

