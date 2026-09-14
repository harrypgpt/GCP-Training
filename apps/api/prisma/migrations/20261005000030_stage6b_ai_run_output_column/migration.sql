-- Additive follow-up to 20261005000000_stage6b_ai_content_intelligence:
-- a nullable output column for AI operations that do not produce
-- AiQuestionCandidate rows (concept extraction, learning-objective
-- generation, ...). Nullable + no default change, so this is a pure
-- additive, non-destructive column.

ALTER TABLE "ai_generation_runs" ADD COLUMN "output" JSONB;
