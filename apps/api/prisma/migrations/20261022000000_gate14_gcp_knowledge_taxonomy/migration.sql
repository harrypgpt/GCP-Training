-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "curation_priority_tier" AS ENUM ('PRIORITY_1', 'PRIORITY_2', 'PRIORITY_3');

-- CreateEnum
CREATE TYPE "learning_objective_source_basis" AS ENUM ('AUTHORITATIVE_SOURCE', 'OBSERVATION_EVIDENCE', 'CURRICULUM_REQUIREMENT', 'EXPERT_CURATED_TRAINING_REQUIREMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'GCP_DOMAIN_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'GCP_DOMAIN_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'GCP_DOMAIN_RETIRED';
ALTER TYPE "audit_action" ADD VALUE 'LEARNING_OBJECTIVE_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'LEARNING_OBJECTIVE_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'LEARNING_OBJECTIVE_RETIRED';
ALTER TYPE "audit_action" ADD VALUE 'GCP_DOMAIN_ROLE_MAP_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_CURATION_PRIORITY_ASSIGNED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_CURATION_CLAIMED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_CURATION_CLAIM_RELEASED';

-- DropForeignKey
ALTER TABLE "learning_objectives" DROP CONSTRAINT "learning_objectives_lesson_id_fkey";

-- AlterTable
ALTER TABLE "gcp_domains" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "learning_objectives" ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "difficulty" "difficulty_level",
ADD COLUMN     "domain_id" UUID,
ADD COLUMN     "rationale" TEXT,
ADD COLUMN     "source_basis" "learning_objective_source_basis" NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL,
ADD COLUMN     "topic" TEXT,
ALTER COLUMN "lesson_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "observation_versions" ADD COLUMN     "curation_claim_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "curation_claimed_at" TIMESTAMPTZ(6),
ADD COLUMN     "curation_claimed_by_id" UUID,
ADD COLUMN     "curation_priority" "curation_priority_tier";

-- CreateTable
CREATE TABLE "gcp_domain_role_map" (
    "id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "professional_role_id" UUID NOT NULL,
    "rationale" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gcp_domain_role_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_objective_professional_roles" (
    "learning_objective_id" UUID NOT NULL,
    "professional_role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_objective_professional_roles_pkey" PRIMARY KEY ("learning_objective_id","professional_role_id")
);

-- CreateIndex
CREATE INDEX "gcp_domain_role_map_professional_role_id_idx" ON "gcp_domain_role_map"("professional_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "gcp_domain_role_map_domain_id_professional_role_id_key" ON "gcp_domain_role_map"("domain_id", "professional_role_id");

-- CreateIndex
CREATE INDEX "learning_objective_professional_roles_professional_role_id_idx" ON "learning_objective_professional_roles"("professional_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_objectives_code_key" ON "learning_objectives"("code");

-- CreateIndex
CREATE INDEX "learning_objectives_domain_id_idx" ON "learning_objectives"("domain_id");

-- CreateIndex
CREATE INDEX "observation_versions_curation_priority_idx" ON "observation_versions"("curation_priority");

-- CreateIndex
CREATE INDEX "observation_versions_curation_claimed_by_id_idx" ON "observation_versions"("curation_claimed_by_id");

-- AddForeignKey
ALTER TABLE "gcp_domain_role_map" ADD CONSTRAINT "gcp_domain_role_map_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gcp_domain_role_map" ADD CONSTRAINT "gcp_domain_role_map_professional_role_id_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gcp_domain_role_map" ADD CONSTRAINT "gcp_domain_role_map_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_objectives" ADD CONSTRAINT "learning_objectives_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_objectives" ADD CONSTRAINT "learning_objectives_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "gcp_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_objective_professional_roles" ADD CONSTRAINT "learning_objective_professional_roles_learning_objective_i_fkey" FOREIGN KEY ("learning_objective_id") REFERENCES "learning_objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_objective_professional_roles" ADD CONSTRAINT "learning_objective_professional_roles_professional_role_id_fkey" FOREIGN KEY ("professional_role_id") REFERENCES "professional_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_versions" ADD CONSTRAINT "observation_versions_curation_claimed_by_id_fkey" FOREIGN KEY ("curation_claimed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

