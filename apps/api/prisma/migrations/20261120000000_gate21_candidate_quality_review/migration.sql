-- CreateTable
CREATE TABLE "ai_candidate_quality_reviews" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "review_comment" TEXT NOT NULL,
    "quality_dimensions" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_candidate_quality_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_candidate_quality_reviews_candidate_id_key" ON "ai_candidate_quality_reviews"("candidate_id");

-- CreateIndex
CREATE INDEX "ai_candidate_quality_reviews_reviewer_id_idx" ON "ai_candidate_quality_reviews"("reviewer_id");

-- AddForeignKey
ALTER TABLE "ai_candidate_quality_reviews" ADD CONSTRAINT "ai_candidate_quality_reviews_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "ai_question_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_candidate_quality_reviews" ADD CONSTRAINT "ai_candidate_quality_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
