-- AlterTable
ALTER TABLE "exam_blueprint_rules" ADD COLUMN     "normative_source_section_id" UUID;

-- CreateIndex
CREATE INDEX "exam_blueprint_rules_normative_source_section_id_idx" ON "exam_blueprint_rules"("normative_source_section_id");

-- AddForeignKey
ALTER TABLE "exam_blueprint_rules" ADD CONSTRAINT "exam_blueprint_rules_normative_source_section_id_fkey" FOREIGN KEY ("normative_source_section_id") REFERENCES "source_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
