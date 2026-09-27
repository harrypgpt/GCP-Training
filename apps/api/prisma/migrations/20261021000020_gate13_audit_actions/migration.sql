-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_CURATION_FIELD_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_CURATION_STATUS_CHANGED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_CURATION_BULK_APPLIED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_SOURCE_LINK_REVIEW_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_SOURCE_LINK_REVIEW_DECIDED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_TRAINING_INTERPRETATION_CREATED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_TRAINING_INTERPRETATION_UPDATED';
ALTER TYPE "audit_action" ADD VALUE 'OBSERVATION_TRAINING_INTERPRETATION_STATUS_CHANGED';

