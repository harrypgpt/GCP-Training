-- CreateEnum
CREATE TYPE "classification_basis" AS ENUM ('SOURCE_EXPLICIT', 'DETERMINISTIC_MAPPING', 'HUMAN_REVIEW_REQUIRED', 'UNMAPPED');

-- AlterEnum
ALTER TYPE "observation_type" ADD VALUE 'FDA_WARNING_LETTER_OBSERVATION';

-- AlterTable
ALTER TABLE "observation_import_batches" ADD COLUMN     "normalization_version" TEXT,
ADD COLUMN     "warning_count" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "observation_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "observation_import_rows" ADD COLUMN     "warnings" JSONB;

-- AlterTable
ALTER TABLE "observation_versions" ADD COLUMN     "case_study_candidate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "classification_basis" JSONB,
ADD COLUMN     "question_generation_candidate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "raw_source_fields" JSONB,
ADD COLUMN     "source_file_name" TEXT,
ADD COLUMN     "source_row_number" INTEGER,
ADD COLUMN     "source_sheet_name" TEXT,
ADD COLUMN     "training_use_candidate" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "observation_versions_source_file_name_source_sheet_name_idx" ON "observation_versions"("source_file_name", "source_sheet_name");

