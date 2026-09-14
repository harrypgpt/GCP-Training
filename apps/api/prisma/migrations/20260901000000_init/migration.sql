-- ICH GCP Training & Certification Platform
-- Migration 0001: foundational schema (users + append-only audit log).

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('LEARNER', 'REVIEWER', 'CONTENT_AUTHOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('USER_REGISTERED', 'EMAIL_VERIFIED', 'USER_LOGGED_IN', 'PASSWORD_CHANGED', 'CONTENT_CREATED', 'CONTENT_MODIFIED', 'CONTENT_APPROVED', 'QUESTION_APPROVED', 'EXAM_STARTED', 'EXAM_SUBMITTED', 'CERTIFICATE_ISSUED', 'CERTIFICATE_REVOKED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "role" "user_role" NOT NULL DEFAULT 'LEARNER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" "audit_action" NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Custom hardening below is not managed by the Prisma schema. It is additive
-- and is replayed with the migration, so `prisma migrate status` stays clean.
-- ---------------------------------------------------------------------------

-- Database-level data-integrity constraints.
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_not_blank_chk" CHECK (length(btrim(email::text)) > 0);
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_shape_chk"
    CHECK (email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
ALTER TABLE "audit_log"
    ADD CONSTRAINT "audit_log_entity_not_blank_chk" CHECK (length(btrim(entity)) > 0);
ALTER TABLE "audit_log"
    ADD CONSTRAINT "audit_log_entity_id_not_blank_chk" CHECK (length(btrim(entity_id)) > 0);

-- Make the audit log append-only for the application connection role.
-- The role that owns the schema during migrations keeps full rights; the
-- runtime application should connect as a less-privileged role in production.
-- We enforce append-only via a trigger so it holds regardless of role.
CREATE OR REPLACE FUNCTION "audit_log_prevent_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_log_no_update"
    BEFORE UPDATE ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION "audit_log_prevent_mutation"();

CREATE TRIGGER "audit_log_no_delete"
    BEFORE DELETE ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION "audit_log_prevent_mutation"();
