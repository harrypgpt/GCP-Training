-- CreateEnum
CREATE TYPE "observation_type" AS ENUM ('FDA_483_OBSERVATION', 'INSPECTION_OBSERVATION', 'AUDIT_OBSERVATION', 'PROPRIETARY_OBSERVATION', 'CLINICAL_OPERATIONS_OBSERVATION', 'OTHER');

-- CreateEnum
CREATE TYPE "observation_evidence_class" AS ENUM ('INSPECTION_EVIDENCE', 'AUDIT_EVIDENCE', 'PRACTICAL_EXPERIENCE', 'INTERNAL_EDUCATIONAL_EVIDENCE');

-- CreateEnum
CREATE TYPE "de_identification_status" AS ENUM ('NOT_REVIEWED', 'REVIEW_REQUIRED', 'DE_IDENTIFIED', 'APPROVED_FOR_INTERNAL_USE', 'APPROVED_FOR_EXTERNAL_AI');

-- CreateEnum
CREATE TYPE "observation_severity" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL', 'NOT_ASSESSED');

-- CreateEnum
CREATE TYPE "observation_risk_dimension" AS ENUM ('PATIENT_SAFETY', 'DATA_INTEGRITY', 'REGULATORY_COMPLIANCE', 'PROTOCOL_COMPLIANCE', 'PRODUCT_QUALITY', 'OPERATIONAL', 'DOCUMENTATION', 'PRIVACY', 'COMPUTERIZED_SYSTEM', 'OTHER');

-- CreateEnum
CREATE TYPE "root_cause_category" AS ENUM ('TRAINING', 'PROCESS', 'SYSTEM', 'PEOPLE', 'GOVERNANCE', 'DOCUMENTATION', 'COMMUNICATION', 'VENDOR', 'RESOURCE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "root_cause_basis" AS ENUM ('DOCUMENTED', 'TRAINING_INFERENCE');

-- CreateEnum
CREATE TYPE "expected_action_basis" AS ENUM ('DOCUMENTED_CORRECTIVE_ACTION', 'TRAINING_EXPECTED_ACTION', 'RECOMMENDED_BEST_PRACTICE');

-- CreateEnum
CREATE TYPE "capa_status" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "import_batch_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "import_row_status" AS ENUM ('VALID', 'INVALID', 'DUPLICATE', 'CREATED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_VERSION_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_VERSION_METADATA_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_VERSION_PUBLISHED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_VERSION_ARCHIVED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_CLASSIFICATION_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_DEIDENTIFICATION_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_AI_ELIGIBILITY_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_SOURCE_LINKAGE_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_IMPORT_BATCH_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_IMPORT_BATCH_COMMITTED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_IMPORT_BATCH_FAILED';

-- AlterTable
ALTER TABLE "observations" ADD COLUMN     "current_published_version_id" UUID;

-- CreateTable
CREATE TABLE "observation_versions" (
    "id" UUID NOT NULL,
    "observation_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "observation_type" "observation_type" NOT NULL,
    "evidence_class" "observation_evidence_class" NOT NULL,
    "original_text" TEXT NOT NULL,
    "normalized_text" TEXT,
    "interpretation_text" TEXT,
    "content_hash" TEXT NOT NULL,
    "external_observation_id" TEXT,
    "issuing_authority" TEXT,
    "source_organization" TEXT,
    "observation_date" DATE,
    "publication_date" DATE,
    "jurisdiction" TEXT,
    "country" TEXT,
    "establishment_info" TEXT,
    "source_url" TEXT,
    "retrieved_at" TIMESTAMPTZ(6),
    "provenance_notes" TEXT,
    "fda483_inspection_id" TEXT,
    "fda483_establishment_id" TEXT,
    "fda483_inspection_date" DATE,
    "fda483_inspection_type" TEXT,
    "fda483_observation_number" TEXT,
    "fda483_product" TEXT,
    "fda483_investigator_info" TEXT,
    "source_id" UUID,
    "source_version_id" UUID,
    "source_section_id" UUID,
    "learning_objective_id" UUID,
    "risk_dimensions" "observation_risk_dimension"[],
    "severity" "observation_severity" NOT NULL DEFAULT 'NOT_ASSESSED',
    "root_cause_category" "root_cause_category",
    "root_cause_basis" "root_cause_basis",
    "root_cause_notes" TEXT,
    "expected_action_text" TEXT,
    "expected_action_basis" "expected_action_basis",
    "capa_corrective_action" TEXT,
    "capa_preventive_action" TEXT,
    "capa_status" "capa_status",
    "capa_source" TEXT,
    "capa_date" DATE,
    "question_generation_hints" JSONB,
    "de_identification_status" "de_identification_status" NOT NULL DEFAULT 'NOT_REVIEWED',
    "de_identification_notes" TEXT,
    "access_restriction" "source_access_restriction" NOT NULL DEFAULT 'INTERNAL_KNOWLEDGE_ONLY',
    "license" TEXT,
    "attribution_required" BOOLEAN NOT NULL DEFAULT true,
    "external_ai_eligibility" "external_ai_eligibility" NOT NULL DEFAULT 'INTERNAL_ONLY',
    "review_status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "import_batch_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "observation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation_version_professional_roles" (
    "observation_version_id" UUID NOT NULL,
    "professional_role_id" UUID NOT NULL,

    CONSTRAINT "observation_version_professional_roles_pkey" PRIMARY KEY ("observation_version_id","professional_role_id")
);

-- CreateTable
CREATE TABLE "observation_version_case_studies" (
    "observation_version_id" UUID NOT NULL,
    "case_study_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observation_version_case_studies_pkey" PRIMARY KEY ("observation_version_id","case_study_id")
);

-- CreateTable
CREATE TABLE "observation_import_batches" (
    "id" UUID NOT NULL,
    "source_label" TEXT NOT NULL,
    "original_filename" TEXT,
    "status" "import_batch_status" NOT NULL DEFAULT 'PENDING',
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "accepted_records" INTEGER NOT NULL DEFAULT 0,
    "rejected_records" INTEGER NOT NULL DEFAULT 0,
    "duplicate_records" INTEGER NOT NULL DEFAULT 0,
    "failed_records" INTEGER NOT NULL DEFAULT 0,
    "initiated_by_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observation_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation_import_rows" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "raw_data" JSONB NOT NULL,
    "status" "import_row_status" NOT NULL,
    "errors" JSONB,
    "observation_code" TEXT,
    "created_observation_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observation_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "observation_versions_observation_id_idx" ON "observation_versions"("observation_id");

-- CreateIndex
CREATE INDEX "observation_versions_review_status_idx" ON "observation_versions"("review_status");

-- CreateIndex
CREATE INDEX "observation_versions_observation_type_idx" ON "observation_versions"("observation_type");

-- CreateIndex
CREATE INDEX "observation_versions_evidence_class_idx" ON "observation_versions"("evidence_class");

-- CreateIndex
CREATE INDEX "observation_versions_de_identification_status_idx" ON "observation_versions"("de_identification_status");

-- CreateIndex
CREATE INDEX "observation_versions_external_ai_eligibility_idx" ON "observation_versions"("external_ai_eligibility");

-- CreateIndex
CREATE INDEX "observation_versions_content_hash_idx" ON "observation_versions"("content_hash");

-- CreateIndex
CREATE INDEX "observation_versions_external_observation_id_idx" ON "observation_versions"("external_observation_id");

-- CreateIndex
CREATE UNIQUE INDEX "observation_versions_observation_id_version_number_key" ON "observation_versions"("observation_id", "version_number");

-- CreateIndex
CREATE INDEX "observation_version_professional_roles_professional_role_id_idx" ON "observation_version_professional_roles"("professional_role_id");

-- CreateIndex
CREATE INDEX "observation_version_case_studies_case_study_id_idx" ON "observation_version_case_studies"("case_study_id");

-- CreateIndex
CREATE INDEX "observation_import_batches_status_idx" ON "observation_import_batches"("status");

-- CreateIndex
CREATE INDEX "observation_import_rows_batch_id_idx" ON "observation_import_rows"("batch_id");

-- CreateIndex
CREATE INDEX "observation_import_rows_status_idx" ON "observation_import_rows"("status");

-- CreateIndex
CREATE UNIQUE INDEX "observations_current_published_version_id_key" ON "observations"("current_published_version_id");

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_current_published_version_id_fkey" FOREIGN KEY ("current_published_version_id") REFERENCES "observation_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_versions" ADD CONSTRAINT "observation_versions_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_versions" ADD CONSTRAINT "observation_versions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_versions" ADD CONSTRAINT "observation_versions_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_versions" ADD CONSTRAINT "observation_versions_source_section_id_fkey" FOREIGN KEY ("source_section_id") REFERENCES "source_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_versions" ADD CONSTRAINT "observation_versions_learning_objective_id_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_versions" ADD CONSTRAINT "observation_versions_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "observation_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_versions" ADD CONSTRAINT "observation_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_version_professional_roles" ADD CONSTRAINT "observation_version_professional_roles_observation_version_fkey" FOREIGN KEY ("observation_version_id") REFERENCES "observation_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_version_professional_roles" ADD CONSTRAINT "observation_version_professional_roles_professional_role_i_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_version_case_studies" ADD CONSTRAINT "observation_version_case_studies_observation_version_id_fkey" FOREIGN KEY ("observation_version_id") REFERENCES "observation_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_version_case_studies" ADD CONSTRAINT "observation_version_case_studies_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_import_batches" ADD CONSTRAINT "observation_import_batches_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_import_rows" ADD CONSTRAINT "observation_import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "observation_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_import_rows" ADD CONSTRAINT "observation_import_rows_created_observation_version_id_fkey" FOREIGN KEY ("created_observation_version_id") REFERENCES "observation_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

