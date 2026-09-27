-- AlterTable
ALTER TABLE "ai_generation_runs" ADD COLUMN     "grounding_case_study_version_id" UUID;

-- AlterTable
ALTER TABLE "ai_question_candidates" ADD COLUMN     "case_study_version_id" UUID;

-- CreateIndex
CREATE INDEX "ai_generation_runs_grounding_case_study_version_id_idx" ON "ai_generation_runs"("grounding_case_study_version_id");

-- CreateIndex
CREATE INDEX "ai_question_candidates_case_study_version_id_idx" ON "ai_question_candidates"("case_study_version_id");

-- AddForeignKey
ALTER TABLE "ai_generation_runs" ADD CONSTRAINT "ai_generation_runs_grounding_case_study_version_id_fkey" FOREIGN KEY ("grounding_case_study_version_id") REFERENCES "case_study_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_question_candidates" ADD CONSTRAINT "ai_question_candidates_case_study_version_id_fkey" FOREIGN KEY ("case_study_version_id") REFERENCES "case_study_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
