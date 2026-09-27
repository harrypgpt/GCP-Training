-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "case_study_tranche_priority_tier" AS ENUM ('PRIORITY_1', 'PRIORITY_2', 'PRIORITY_3');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_TRANCHE_SELECTED';
ALTER TYPE "audit_action" ADD VALUE 'CASE_STUDY_SPECIFICATION_VALIDATED';

-- CreateTable
CREATE TABLE "case_study_tranches" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "selection_criteria" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_study_tranches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_study_tranche_items" (
    "id" UUID NOT NULL,
    "tranche_id" UUID NOT NULL,
    "observation_version_id" UUID NOT NULL,
    "priority_tier" "case_study_tranche_priority_tier",
    "included" BOOLEAN NOT NULL DEFAULT false,
    "eligibility_state" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "exclusion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_study_tranche_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "case_study_tranches_code_key" ON "case_study_tranches"("code");

-- CreateIndex
CREATE INDEX "case_study_tranche_items_observation_version_id_idx" ON "case_study_tranche_items"("observation_version_id");

-- CreateIndex
CREATE INDEX "case_study_tranche_items_included_idx" ON "case_study_tranche_items"("included");

-- CreateIndex
CREATE UNIQUE INDEX "case_study_tranche_items_tranche_id_observation_version_id_key" ON "case_study_tranche_items"("tranche_id", "observation_version_id");

-- AddForeignKey
ALTER TABLE "case_study_tranches" ADD CONSTRAINT "case_study_tranches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_tranche_items" ADD CONSTRAINT "case_study_tranche_items_tranche_id_fkey" FOREIGN KEY ("tranche_id") REFERENCES "case_study_tranches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_tranche_items" ADD CONSTRAINT "case_study_tranche_items_observation_version_id_fkey" FOREIGN KEY ("observation_version_id") REFERENCES "observation_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

