import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const REVIEW_DECISIONS = ['APPROVE', 'REJECT', 'REQUEST_REVISION'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/// Gate 15 §22: a human review decision - AI can never approve itself, and
/// this endpoint is the only path a CaseStudyVersion can reach APPROVED.
export class ReviewCaseStudyVersionDto {
  @IsIn(REVIEW_DECISIONS)
  decision!: ReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
