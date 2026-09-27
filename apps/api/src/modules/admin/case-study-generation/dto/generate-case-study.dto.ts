import { IsIn, IsOptional } from 'class-validator';

/// Mirrors GenerationContextDto's test-only failure-injection field
/// (Gate 15 §31) - honoured ONLY by the mock provider.
export class GenerateCaseStudyDto {
  @IsOptional()
  @IsIn([
    'timeout',
    'unavailable',
    'refused',
    'malformed',
    'insufficient_evidence',
    'unsupported_claim',
  ])
  simulate?:
    | 'timeout'
    | 'unavailable'
    | 'refused'
    | 'malformed'
    | 'insufficient_evidence'
    | 'unsupported_claim';
}
