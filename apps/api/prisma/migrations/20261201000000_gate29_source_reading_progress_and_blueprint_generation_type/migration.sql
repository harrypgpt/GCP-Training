-- CreateEnum
CREATE TYPE "reading_completion_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'RETRAINING_REQUIRED');

-- AlterTable
ALTER TABLE "exam_blueprint_rules" ADD COLUMN     "question_generation_type" "question_generation_type";

-- CreateTable
CREATE TABLE "source_reading_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source_version_id" UUID NOT NULL,
    "status" "reading_completion_status" NOT NULL DEFAULT 'NOT_STARTED',
    "last_viewed_sequence" INTEGER NOT NULL DEFAULT 0,
    "training_started_at" TIMESTAMPTZ(6),
    "training_completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "source_reading_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_reading_progress_source_version_id_idx" ON "source_reading_progress"("source_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_reading_progress_user_id_source_version_id_key" ON "source_reading_progress"("user_id", "source_version_id");

-- AddForeignKey
ALTER TABLE "source_reading_progress" ADD CONSTRAINT "source_reading_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_reading_progress" ADD CONSTRAINT "source_reading_progress_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
