-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "case_study_scenario_type" AS ENUM ('INVESTIGATOR_DECISION', 'CRA_DECISION', 'SPONSOR_DECISION', 'SITE_QUALITY_DECISION', 'DATA_INTEGRITY_SCENARIO', 'DOCUMENTATION_SCENARIO', 'MONITORING_SCENARIO', 'INFORMED_CONSENT_SCENARIO', 'SAFETY_SCENARIO', 'VENDOR_OVERSIGHT_SCENARIO', 'COMPUTERIZED_SYSTEM_SCENARIO', 'AUDIT_TRAIL_SCENARIO', 'TRAINING_SCENARIO', 'CAPA_SCENARIO', 'INSPECTION_READINESS_SCENARIO');

-- CreateEnum
CREATE TYPE "case_study_specification_status" AS ENUM ('DRAFT', 'READY_FOR_GENERATION', 'GENERATION_IN_PROGRESS', 'GENERATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "case_study_version_status" AS ENUM ('DRAFT', 'READY_FOR_GENERATION', 'GENERATION_IN_PROGRESS', 'GENERATED', 'VALIDATION_FAILED', 'READY_FOR_REVIEW', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "case_study_generation_method" AS ENUM ('HUMAN_AUTHORED', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "case_study_validation_status" AS ENUM ('NOT_VALIDATED', 'VALIDATED', 'VALIDATION_FAILED', 'HUMAN_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "case_study_evidence_type" AS ENUM ('OBSERVATION', 'SOURCE_SECTION', 'TRAINING_INTERPRETATION', 'LEARNING_OBJECTIVE');

-- CreateEnum
CREATE TYPE "case_study_evidence_role" AS ENUM ('PRIMARY_OBSERVATION', 'SOURCE_SUPPORT', 'TRAINING_INTERPRETATION', 'CONTEXT', 'SCENARIO_CONSTRUCTION');

-- CreateEnum
CREATE TYPE "case_study_specification_observation_role" AS ENUM ('PRIMARY', 'SUPPORTING');

-- AlterEnum
ALTER TYPE "ai_operation" ADD VALUE 'CASE_STUDY_GENERATION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_SPECIFICATION_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_SPECIFICATION_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_GENERATION_REQUESTED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_GENERATION_COMPLETED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_GENERATION_FAILED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_VALIDATION_FAILED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_REVIEW_STARTED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_APPROVED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_REJECTED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_REVISION_REQUESTED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_PUBLISHED';

-- AlterTable
ALTER TABLE "ai_generation_runs" ADD COLUMN     "case_study_specification_id" UUID;

-- AlterTable
ALTER TABLE "case_studies" ADD COLUMN     "current_published_version_id" UUID;

-- CreateTable
CREATE TABLE "case_study_specifications" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scenario_type" "case_study_scenario_type" NOT NULL,
    "status" "case_study_specification_status" NOT NULL DEFAULT 'DRAFT',
    "domain_id" UUID,
    "learning_objective_id" UUID,
    "primary_observation_version_id" UUID NOT NULL,
    "training_interpretation_id" UUID,
    "risk_dimensions" "observation_risk_dimension"[],
    "severity" "observation_severity",
    "root_cause_category" "root_cause_category",
    "desired_decision_point" TEXT,
    "expected_learner_competency" TEXT,
    "allowed_factual_boundaries" TEXT,
    "prohibited_assumptions" TEXT,
    "generation_constraints" JSONB,
    "active_generation_run_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "case_study_specifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_study_specification_professional_roles" (
    "specification_id" UUID NOT NULL,
    "professional_role_id" UUID NOT NULL,

    CONSTRAINT "case_study_specification_professional_roles_pkey" PRIMARY KEY ("specification_id","professional_role_id")
);

-- CreateTable
CREATE TABLE "case_study_specification_observations" (
    "specification_id" UUID NOT NULL,
    "observation_version_id" UUID NOT NULL,
    "role" "case_study_specification_observation_role" NOT NULL DEFAULT 'SUPPORTING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_study_specification_observations_pkey" PRIMARY KEY ("specification_id","observation_version_id")
);

-- CreateTable
CREATE TABLE "case_study_versions" (
    "id" UUID NOT NULL,
    "case_study_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "case_study_version_status" NOT NULL DEFAULT 'DRAFT',
    "generation_method" "case_study_generation_method" NOT NULL DEFAULT 'HUMAN_AUTHORED',
    "specification_id" UUID,
    "generation_run_id" UUID,
    "validation_status" "case_study_validation_status" NOT NULL DEFAULT 'NOT_VALIDATED',
    "validation_report" JSONB,
    "title" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "domain_id" UUID,
    "learning_objective_id" UUID,
    "content" JSONB NOT NULL,
    "reviewer_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_notes" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "case_study_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_study_version_professional_roles" (
    "version_id" UUID NOT NULL,
    "professional_role_id" UUID NOT NULL,

    CONSTRAINT "case_study_version_professional_roles_pkey" PRIMARY KEY ("version_id","professional_role_id")
);

-- CreateTable
CREATE TABLE "case_study_evidence_references" (
    "id" UUID NOT NULL,
    "case_study_version_id" UUID NOT NULL,
    "evidence_type" "case_study_evidence_type" NOT NULL,
    "evidence_role" "case_study_evidence_role" NOT NULL,
    "source_id" UUID,
    "source_version_id" UUID,
    "source_section_id" UUID,
    "observation_id" UUID,
    "observation_version_id" UUID,
    "training_interpretation_id" UUID,
    "learning_objective_id" UUID,
    "claimText" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_study_evidence_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "case_study_specifications_code_key" ON "case_study_specifications"("code");

-- CreateIndex
CREATE UNIQUE INDEX "case_study_specifications_active_generation_run_id_key" ON "case_study_specifications"("active_generation_run_id");

-- CreateIndex
CREATE INDEX "case_study_specifications_domain_id_idx" ON "case_study_specifications"("domain_id");

-- CreateIndex
CREATE INDEX "case_study_specifications_status_idx" ON "case_study_specifications"("status");

-- CreateIndex
CREATE INDEX "case_study_specifications_primary_observation_version_id_idx" ON "case_study_specifications"("primary_observation_version_id");

-- CreateIndex
CREATE INDEX "case_study_specifications_scenario_type_idx" ON "case_study_specifications"("scenario_type");

-- CreateIndex
CREATE INDEX "case_study_specification_professional_roles_professional_ro_idx" ON "case_study_specification_professional_roles"("professional_role_id");

-- CreateIndex
CREATE INDEX "case_study_specification_observations_observation_version_i_idx" ON "case_study_specification_observations"("observation_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_study_versions_generation_run_id_key" ON "case_study_versions"("generation_run_id");

-- CreateIndex
CREATE INDEX "case_study_versions_case_study_id_idx" ON "case_study_versions"("case_study_id");

-- CreateIndex
CREATE INDEX "case_study_versions_status_idx" ON "case_study_versions"("status");

-- CreateIndex
CREATE INDEX "case_study_versions_specification_id_idx" ON "case_study_versions"("specification_id");

-- CreateIndex
CREATE INDEX "case_study_versions_validation_status_idx" ON "case_study_versions"("validation_status");

-- CreateIndex
CREATE UNIQUE INDEX "case_study_versions_case_study_id_version_number_key" ON "case_study_versions"("case_study_id", "version_number");

-- CreateIndex
CREATE INDEX "case_study_version_professional_roles_professional_role_id_idx" ON "case_study_version_professional_roles"("professional_role_id");

-- CreateIndex
CREATE INDEX "case_study_evidence_references_case_study_version_id_idx" ON "case_study_evidence_references"("case_study_version_id");

-- CreateIndex
CREATE INDEX "case_study_evidence_references_observation_version_id_idx" ON "case_study_evidence_references"("observation_version_id");

-- CreateIndex
CREATE INDEX "case_study_evidence_references_source_section_id_idx" ON "case_study_evidence_references"("source_section_id");

-- CreateIndex
CREATE INDEX "ai_generation_runs_case_study_specification_id_idx" ON "ai_generation_runs"("case_study_specification_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_studies_current_published_version_id_key" ON "case_studies"("current_published_version_id");

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_current_published_version_id_fkey" FOREIGN KEY ("current_published_version_id") REFERENCES "case_study_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_specifications" ADD CONSTRAINT "case_study_specifications_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_specifications" ADD CONSTRAINT "case_study_specifications_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_specifications" ADD CONSTRAINT "case_study_specifications_primary_observation_version_id_fkey" FOREIGN KEY ("primary_observation_version_id") REFERENCES "observation_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_specifications" ADD CONSTRAINT "case_study_specifications_training_interpretation_id_fkey" FOREIGN KEY ("training_interpretation_id") REFERENCES "observation_training_interpretations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_specifications" ADD CONSTRAINT "case_study_specifications_active_generation_run_id_fkey" FOREIGN KEY ("active_generation_run_id") REFERENCES "ai_generation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_specifications" ADD CONSTRAINT "case_study_specifications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_specification_professional_roles" ADD CONSTRAINT "case_study_specification_professional_roles_specification__fkey" FOREIGN KEY ("specification_id") REFERENCES "case_study_specifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_specification_professional_roles" ADD CONSTRAINT "case_study_specification_professional_roles_professional_r_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_specification_observations" ADD CONSTRAINT "case_study_specification_observations_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "case_study_specifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_specification_observations" ADD CONSTRAINT "case_study_specification_observations_observation_version__fkey" FOREIGN KEY ("observation_version_id") REFERENCES "observation_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_versions" ADD CONSTRAINT "case_study_versions_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_versions" ADD CONSTRAINT "case_study_versions_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "case_study_specifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_versions" ADD CONSTRAINT "case_study_versions_generation_run_id_fkey" FOREIGN KEY ("generation_run_id") REFERENCES "ai_generation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_versions" ADD CONSTRAINT "case_study_versions_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_versions" ADD CONSTRAINT "case_study_versions_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_versions" ADD CONSTRAINT "case_study_versions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_versions" ADD CONSTRAINT "case_study_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_version_professional_roles" ADD CONSTRAINT "case_study_version_professional_roles_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "case_study_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_version_professional_roles" ADD CONSTRAINT "case_study_version_professional_roles_professional_role_id_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_evidence_references" ADD CONSTRAINT "case_study_evidence_references_case_study_version_id_fkey" FOREIGN KEY ("case_study_version_id") REFERENCES "case_study_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_evidence_references" ADD CONSTRAINT "case_study_evidence_references_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_evidence_references" ADD CONSTRAINT "case_study_evidence_references_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_evidence_references" ADD CONSTRAINT "case_study_evidence_references_source_section_id_fkey" FOREIGN KEY ("source_section_id") REFERENCES "source_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_evidence_references" ADD CONSTRAINT "case_study_evidence_references_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_evidence_references" ADD CONSTRAINT "case_study_evidence_references_observation_version_id_fkey" FOREIGN KEY ("observation_version_id") REFERENCES "observation_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_evidence_references" ADD CONSTRAINT "case_study_evidence_references_training_interpretation_id_fkey" FOREIGN KEY ("training_interpretation_id") REFERENCES "observation_training_interpretations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_evidence_references" ADD CONSTRAINT "case_study_evidence_references_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_case_study_specification_id_fkey" FOREIGN KEY ("case_study_specification_id") REFERENCES "case_study_specifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

