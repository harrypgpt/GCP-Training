-- CreateEnum
CREATE TYPE "source_authority" AS ENUM ('AUTHORITATIVE_REGULATORY', 'OFFICIAL_GUIDANCE', 'SCIENTIFIC_LITERATURE', 'EDUCATIONAL_REFERENCE', 'INTERNAL_EDUCATIONAL', 'PROPRIETARY_EXPERIENCE');

-- CreateEnum
CREATE TYPE "extraction_method" AS ENUM ('TEXT_LAYER', 'OCR', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "extraction_status" AS ENUM ('PENDING', 'EXTRACTED', 'OCR_EXTRACTED', 'NEEDS_REVIEW', 'FAILED', 'APPROVED');

-- CreateEnum
CREATE TYPE "source_section_type" AS ENUM ('HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'NOTE', 'FOOTNOTE', 'DEFINITION', 'ANNEX', 'CROSS_REFERENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "source_relation_type" AS ENUM ('SUPERSEDES', 'REFERENCES', 'RELATED_TO', 'IMPLEMENTS', 'INTERPRETS');

-- CreateEnum
CREATE TYPE "source_access_restriction" AS ENUM ('INTERNAL_KNOWLEDGE_ONLY', 'PUBLIC_REDISTRIBUTION_PERMITTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'SOURCE_VERSION_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'SOURCE_VERSION_METADATA_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'SOURCE_INGESTION_STARTED';
ALTER TYPE "audit_action" ADD VALUE 'SOURCE_INGESTION_COMPLETED';
ALTER TYPE "audit_action" ADD VALUE 'SOURCE_INGESTION_FAILED';
ALTER TYPE "audit_action" ADD VALUE 'SOURCE_VERSION_PUBLISHED';
ALTER TYPE "audit_action" ADD VALUE 'SOURCE_VERSION_ARCHIVED';

-- AlterTable
ALTER TABLE "case_studies" ADD COLUMN     "source_section_ref_id" UUID;

-- AlterTable
ALTER TABLE "observations" ADD COLUMN     "source_section_ref_id" UUID;

-- AlterTable
ALTER TABLE "question_versions" ADD COLUMN     "source_section_ref_id" UUID;

-- AlterTable
ALTER TABLE "sources" ADD COLUMN     "current_published_version_id" UUID;

-- CreateTable
CREATE TABLE "source_versions" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "issuing_organization" TEXT,
    "authority" "source_authority" NOT NULL,
    "jurisdiction" TEXT,
    "document_version" TEXT,
    "revision" TEXT,
    "language" TEXT,
    "publication_date" DATE,
    "effective_date" DATE,
    "canonical_url" TEXT,
    "document_identifier" TEXT,
    "retrieved_at" TIMESTAMPTZ(6),
    "provenance_notes" TEXT,
    "checksum" TEXT,
    "extracted_content_hash" TEXT,
    "review_status" "content_status" NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "license" TEXT,
    "access_restriction" "source_access_restriction" NOT NULL DEFAULT 'INTERNAL_KNOWLEDGE_ONLY',
    "attribution_required" BOOLEAN NOT NULL DEFAULT true,
    "external_ai_eligibility" "external_ai_eligibility" NOT NULL DEFAULT 'INTERNAL_ONLY',
    "original_filename" TEXT,
    "mime_type" TEXT,
    "file_size_bytes" INTEGER,
    "extraction_method" "extraction_method",
    "extraction_status" "extraction_status" NOT NULL DEFAULT 'PENDING',
    "extractor_version" TEXT,
    "ingestion_started_at" TIMESTAMPTZ(6),
    "ingestion_completed_at" TIMESTAMPTZ(6),
    "ingestion_error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "source_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_sections" (
    "id" UUID NOT NULL,
    "source_version_id" UUID NOT NULL,
    "parent_section_id" UUID,
    "section_identifier" TEXT NOT NULL,
    "heading" TEXT,
    "section_type" "source_section_type" NOT NULL DEFAULT 'PARAGRAPH',
    "sequence" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "pdf_page_start" INTEGER,
    "pdf_page_end" INTEGER,
    "document_page" TEXT,
    "paragraph_ref" TEXT,
    "anchor" TEXT,
    "extraction_status" "extraction_status" NOT NULL DEFAULT 'PENDING',
    "extraction_method" "extraction_method",
    "cross_reference_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "source_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_version_relationships" (
    "id" UUID NOT NULL,
    "from_version_id" UUID NOT NULL,
    "to_version_id" UUID NOT NULL,
    "relation_type" "source_relation_type" NOT NULL,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_version_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_versions_source_id_idx" ON "source_versions"("source_id");

-- CreateIndex
CREATE INDEX "source_versions_review_status_idx" ON "source_versions"("review_status");

-- CreateIndex
CREATE INDEX "source_versions_authority_idx" ON "source_versions"("authority");

-- CreateIndex
CREATE INDEX "source_versions_extraction_status_idx" ON "source_versions"("extraction_status");

-- CreateIndex
CREATE INDEX "source_versions_external_ai_eligibility_idx" ON "source_versions"("external_ai_eligibility");

-- CreateIndex
CREATE INDEX "source_versions_checksum_idx" ON "source_versions"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "source_versions_source_id_version_number_key" ON "source_versions"("source_id", "version_number");

-- CreateIndex
CREATE INDEX "source_sections_source_version_id_sequence_idx" ON "source_sections"("source_version_id", "sequence");

-- CreateIndex
CREATE INDEX "source_sections_parent_section_id_idx" ON "source_sections"("parent_section_id");

-- CreateIndex
CREATE INDEX "source_sections_content_hash_idx" ON "source_sections"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "source_sections_source_version_id_section_identifier_key" ON "source_sections"("source_version_id", "section_identifier");

-- CreateIndex
CREATE INDEX "source_version_relationships_to_version_id_idx" ON "source_version_relationships"("to_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_version_relationships_from_version_id_to_version_id__key" ON "source_version_relationships"("from_version_id", "to_version_id", "relation_type");

-- CreateIndex
CREATE UNIQUE INDEX "sources_current_published_version_id_key" ON "sources"("current_published_version_id");

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_current_published_version_id_fkey" FOREIGN KEY ("current_published_version_id") REFERENCES "source_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "source_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_sections" ADD CONSTRAINT "source_sections_parent_section_id_fkey" FOREIGN KEY ("parent_section_id") REFERENCES "source_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_version_relationships" ADD CONSTRAINT "source_version_relationships_from_version_id_fkey" FOREIGN KEY ("from_version_id") REFERENCES "source_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_version_relationships" ADD CONSTRAINT "source_version_relationships_to_version_id_fkey" FOREIGN KEY ("to_version_id") REFERENCES "source_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_version_relationships" ADD CONSTRAINT "source_version_relationships_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_source_section_ref_id_fkey" FOREIGN KEY ("source_section_ref_id") REFERENCES "source_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_source_section_ref_id_fkey" FOREIGN KEY ("source_section_ref_id") REFERENCES "source_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_source_section_ref_id_fkey" FOREIGN KEY ("source_section_ref_id") REFERENCES "source_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

