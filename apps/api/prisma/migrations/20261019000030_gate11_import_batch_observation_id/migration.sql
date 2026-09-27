-- AlterTable
ALTER TABLE "observation_import_batches" ADD COLUMN     "observation_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "observation_import_batches_observation_id_idx" ON "observation_import_batches"("observation_id");

-- AddForeignKey
ALTER TABLE "observation_import_batches" ADD CONSTRAINT "observation_import_batches_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

