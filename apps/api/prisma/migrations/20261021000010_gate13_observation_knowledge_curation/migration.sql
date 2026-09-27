-- CreateEnum
CREATE TYPE "source_link_review_status" AS ENUM ('VERIFIED', 'HUMAN_REVIEW_REQUIRED', 'NOT_LINKED');

-- CreateEnum
CREATE TYPE "learning_objective_match_type" AS ENUM ('EXACT_EXISTING_MATCH', 'CURATED_MATCH', 'HUMAN_REVIEW_REQUIRED', 'NO_MATCH');

-- CreateEnum
CREATE TYPE "readiness_status" AS ENUM ('NOT_ASSESSED', 'NOT_SUITABLE', 'CANDIDATE', 'APPROVED');

-- CreateEnum
CREATE TYPE "curation_workflow_status" AS ENUM ('IMPORTED', 'CURATION_REQUIRED', 'IN_REVIEW', 'CURATED', 'APPROVED');

-- CreateEnum
CREATE TYPE "training_interpretation_type" AS ENUM ('PRACTICAL_LESSON', 'RISK_EXPLANATION', 'VERIFICATION_GUIDANCE', 'PROFESSIONAL_ACTION', 'GENERAL');

-- AlterTable
ALTER TABLE "observation_version_professional_roles" ADD COLUMN     "basis" "classification_basis" NOT NULL DEFAULT 'HUMAN_CURATED',
ADD COLUMN     "curated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "curated_by_id" UUID,
ADD COLUMN     "rationale" TEXT;

-- AlterTable
ALTER TABLE "observation_versions" ADD COLUMN     "case_study_readiness" "readiness_status" NOT NULL DEFAULT 'NOT_ASSESSED',
ADD COLUMN     "curation_status" "curation_workflow_status" NOT NULL DEFAULT 'IMPORTED',
ADD COLUMN     "domain_id" UUID,
ADD COLUMN     "learning_objective_match_type" "learning_objective_match_type",
ADD COLUMN     "question_generation_readiness" "readiness_status" NOT NULL DEFAULT 'NOT_ASSESSED',
ADD COLUMN     "training_use_readiness" "readiness_status" NOT NULL DEFAULT 'NOT_ASSESSED';

-- CreateTable
CREATE TABLE "observation_curation_history" (
    "id" UUID NOT NULL,
    "observation_version_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "previous_value" JSONB,
    "new_value" JSONB,
    "basis" "classification_basis" NOT NULL,
    "rationale" TEXT,
    "curated_by_id" UUID,
    "curated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observation_curation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation_source_link_reviews" (
    "id" UUID NOT NULL,
    "observation_version_id" UUID NOT NULL,
    "citation_text" TEXT NOT NULL,
    "candidate_source_id" UUID,
    "candidate_source_version_id" UUID,
    "candidate_source_section_id" UUID,
    "status" "source_link_review_status" NOT NULL DEFAULT 'NOT_LINKED',
    "rationale" TEXT,
    "reviewer_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observation_source_link_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation_training_interpretations" (
    "id" UUID NOT NULL,
    "observation_version_id" UUID NOT NULL,
    "interpretation_type" "training_interpretation_type" NOT NULL,
    "text" TEXT NOT NULL,
    "rationale" TEXT,
    "review_status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "observation_training_interpretations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "observation_curation_history_observation_version_id_idx" ON "observation_curation_history"("observation_version_id");

-- CreateIndex
CREATE INDEX "observation_curation_history_field_idx" ON "observation_curation_history"("field");

-- CreateIndex
CREATE INDEX "observation_source_link_reviews_observation_version_id_idx" ON "observation_source_link_reviews"("observation_version_id");

-- CreateIndex
CREATE INDEX "observation_source_link_reviews_status_idx" ON "observation_source_link_reviews"("status");

-- CreateIndex
CREATE INDEX "observation_training_interpretations_observation_version_id_idx" ON "observation_training_interpretations"("observation_version_id");

-- CreateIndex
CREATE INDEX "observation_training_interpretations_review_status_idx" ON "observation_training_interpretations"("review_status");

-- CreateIndex
CREATE INDEX "observation_versions_domain_id_idx" ON "observation_versions"("domain_id");

-- CreateIndex
CREATE INDEX "observation_versions_curation_status_idx" ON "observation_versions"("curation_status");

-- CreateIndex
CREATE INDEX "observation_versions_case_study_readiness_idx" ON "observation_versions"("case_study_readiness");

-- CreateIndex
CREATE INDEX "observation_versions_question_generation_readiness_idx" ON "observation_versions"("question_generation_readiness");

-- AddForeignKey
ALTER TABLE "observation_versions" ADD CONSTRAINT "observation_versions_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_version_professional_roles" ADD CONSTRAINT "observation_version_professional_roles_curated_by_id_fkey" FOREIGN KEY ("curated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_curation_history" ADD CONSTRAINT "observation_curation_history_observation_version_id_fkey" FOREIGN KEY ("observation_version_id") REFERENCES "observation_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_curation_history" ADD CONSTRAINT "observation_curation_history_curated_by_id_fkey" FOREIGN KEY ("curated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_source_link_reviews" ADD CONSTRAINT "observation_source_link_reviews_observation_version_id_fkey" FOREIGN KEY ("observation_version_id") REFERENCES "observation_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_source_link_reviews" ADD CONSTRAINT "observation_source_link_reviews_candidate_source_id_fkey" FOREIGN KEY ("candidate_source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_source_link_reviews" ADD CONSTRAINT "observation_source_link_reviews_candidate_source_version_i_fkey" FOREIGN KEY ("candidate_source_version_id") REFERENCES "source_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_source_link_reviews" ADD CONSTRAINT "observation_source_link_reviews_candidate_source_section_i_fkey" FOREIGN KEY ("candidate_source_section_id") REFERENCES "source_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_source_link_reviews" ADD CONSTRAINT "observation_source_link_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_training_interpretations" ADD CONSTRAINT "observation_training_interpretations_observation_version_i_fkey" FOREIGN KEY ("observation_version_id") REFERENCES "observation_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_training_interpretations" ADD CONSTRAINT "observation_training_interpretations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

