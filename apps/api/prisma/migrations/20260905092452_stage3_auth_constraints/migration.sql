-- Stage 3 hardening: constraints Prisma's schema DSL cannot express directly.
-- Additive, replayed with the migration history (same pattern as Stages 1-2).

-- Sanity CHECK constraints.
ALTER TABLE "otp_challenges"
    ADD CONSTRAINT "otp_challenges_max_attempts_positive_chk" CHECK ("max_attempts" > 0);
ALTER TABLE "otp_challenges"
    ADD CONSTRAINT "otp_challenges_attempt_count_range_chk"
    CHECK ("attempt_count" >= 0 AND "attempt_count" <= "max_attempts");
ALTER TABLE "otp_challenges"
    ADD CONSTRAINT "otp_challenges_expires_after_created_chk" CHECK ("expires_at" > "created_at");

ALTER TABLE "refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_expires_after_created_chk" CHECK ("expires_at" > "created_at");

-- Defense in depth: only one *active* OTP challenge per user+purpose at a
-- time, enforced at the database level (the service layer already
-- invalidates any prior challenge before issuing a new one).
CREATE UNIQUE INDEX "otp_challenges_one_active_per_user_purpose"
    ON "otp_challenges"("user_id", "purpose")
    WHERE "consumed_at" IS NULL AND "invalidated_at" IS NULL;

-- Only one active (unrevoked) refresh token session need not be unique per
-- user — a learner may hold multiple concurrent sessions/devices — so no
-- analogous partial index is added here.
