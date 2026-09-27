-- AlterTable
-- The `certificates` table has zero rows (no certificate-issuance code path
-- existed before Gate 8 - confirmed by the Gate 7E repository audit), so
-- adding NOT NULL columns without a default is safe here.
ALTER TABLE "certificates"
  ADD COLUMN "verification_code" TEXT NOT NULL,
  ADD COLUMN "exam_version_id" UUID NOT NULL,
  ADD COLUMN "pass_percentage_snapshot" DECIMAL(5, 2) NOT NULL,
  ADD COLUMN "learner_name_snapshot" TEXT NOT NULL,
  ADD COLUMN "program_name_snapshot" TEXT NOT NULL,
  ADD COLUMN "level_name_snapshot" TEXT NOT NULL;

-- AlterTable
-- Gate 8: default 12-month certificate validity, configurable per level.
ALTER TABLE "training_levels"
  ADD COLUMN "certificate_validity_months" INTEGER NOT NULL DEFAULT 12;

-- CreateIndex
CREATE UNIQUE INDEX "certificates_verification_code_key" ON "certificates"("verification_code");

-- CreateIndex
CREATE INDEX "certificates_exam_version_id_idx" ON "certificates"("exam_version_id");

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_exam_version_id_fkey" FOREIGN KEY ("exam_version_id") REFERENCES "exam_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
