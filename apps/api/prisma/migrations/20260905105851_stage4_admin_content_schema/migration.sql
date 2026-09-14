/*
  Warnings:

  - You are about to drop the column `status` on the `lessons` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `modules` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `training_levels` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `training_programs` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "lessons_status_idx";

-- DropIndex
DROP INDEX "modules_status_idx";

-- DropIndex
DROP INDEX "training_levels_status_idx";

-- DropIndex
DROP INDEX "training_programs_status_idx";

-- AlterTable
ALTER TABLE "learning_objectives" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "review_status" "content_status" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "lessons" DROP COLUMN "status",
ADD COLUMN     "review_status" "content_status" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "modules" DROP COLUMN "status",
ADD COLUMN     "review_status" "content_status" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "observations" ADD COLUMN     "review_status" "content_status" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "sources" ADD COLUMN     "review_status" "content_status" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "training_levels" DROP COLUMN "status",
ADD COLUMN     "review_status" "content_status" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "training_programs" DROP COLUMN "status",
ADD COLUMN     "review_status" "content_status" NOT NULL DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX "learning_objectives_review_status_idx" ON "learning_objectives"("review_status");

-- CreateIndex
CREATE INDEX "lessons_review_status_idx" ON "lessons"("review_status");

-- CreateIndex
CREATE INDEX "modules_review_status_idx" ON "modules"("review_status");

-- CreateIndex
CREATE INDEX "observations_review_status_idx" ON "observations"("review_status");

-- CreateIndex
CREATE INDEX "sources_review_status_idx" ON "sources"("review_status");

-- CreateIndex
CREATE INDEX "training_levels_review_status_idx" ON "training_levels"("review_status");

-- CreateIndex
CREATE INDEX "training_programs_review_status_idx" ON "training_programs"("review_status");

-- AddForeignKey
ALTER TABLE "learning_objectives" ADD CONSTRAINT "learning_objectives_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
