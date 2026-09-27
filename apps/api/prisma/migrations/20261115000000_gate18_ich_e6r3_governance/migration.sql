-- CreateEnum
CREATE TYPE "question_generation_type" AS ENUM ('DIRECT_GCP', 'CASE_APPLICATION');

-- CreateEnum
CREATE TYPE "normative_source" AS ENUM ('ICH_E6_R3');

-- CreateEnum
CREATE TYPE "question_scenario_source_type" AS ENUM ('NONE', 'FDA_WARNING_LETTER', 'FDA_483', 'PRACTICAL_OBSERVATION', 'EXPERT_OBSERVATION', 'OTHER_APPROVED_CASE_EVIDENCE');

-- AlterTable
ALTER TABLE "ai_question_candidates" ADD COLUMN     "learning_objective_match_type" "learning_objective_match_type",
ADD COLUMN     "normative_source" "normative_source",
ADD COLUMN     "normative_source_section_id" UUID,
ADD COLUMN     "normative_source_version_id" UUID,
ADD COLUMN     "question_generation_type" "question_generation_type",
ADD COLUMN     "scenario_source_type" "question_scenario_source_type";

-- CreateIndex
CREATE INDEX "ai_question_candidates_normative_source_version_id_idx" ON "ai_question_candidates"("normative_source_version_id");

-- CreateIndex
CREATE INDEX "ai_question_candidates_normative_source_section_id_idx" ON "ai_question_candidates"("normative_source_section_id");

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_normative_source_version_id_fkey" FOREIGN KEY ("normative_source_version_id") REFERENCES "source_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_normative_source_section_id_fkey" FOREIGN KEY ("normative_source_section_id") REFERENCES "source_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

