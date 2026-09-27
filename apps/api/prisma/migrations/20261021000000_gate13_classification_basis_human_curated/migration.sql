-- AlterEnum
-- Split into its own migration: Postgres forbids using a brand-new enum
-- value in the same transaction that adds it (a DEFAULT referencing
-- HUMAN_CURATED below requires this value to already be committed).
ALTER TYPE "classification_basis" ADD VALUE 'HUMAN_CURATED';
