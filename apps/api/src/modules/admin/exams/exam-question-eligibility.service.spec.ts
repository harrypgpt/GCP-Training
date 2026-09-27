import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { ExamQuestionEligibilityService } from './exam-question-eligibility.service';

function baseVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v-1',
    reviewStatus: 'PUBLISHED',
    isActive: true,
    stem: 'Who is responsible for informed consent under ICH GCP?',
    explanation: 'The investigator holds primary responsibility.',
    learningObjectiveId: 'obj-1',
    sourceId: 'src-1',
    observationId: null,
    question: { currentPublishedVersionId: 'v-1' },
    options: [
      { content: 'The investigator', isCorrect: true, isActive: true },
      { content: 'The sponsor', isCorrect: false, isActive: true },
    ],
    caseStudyLinks: [],
    ...overrides,
  };
}

describe('ExamQuestionEligibilityService', () => {
  const findUnique = jest.fn();
  const findMany = jest.fn();

  async function createService(): Promise<ExamQuestionEligibilityService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExamQuestionEligibilityService,
        { provide: PrismaService, useValue: { questionVersion: { findUnique, findMany } } },
      ],
    }).compile();
    return moduleRef.get(ExamQuestionEligibilityService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkEligibility', () => {
    it('reports QUESTION_VERSION_NOT_FOUND when the version does not exist', async () => {
      findUnique.mockResolvedValue(null);
      const service = await createService();

      const result = await service.checkEligibility('missing');

      expect(result).toEqual({
        eligible: false,
        reasons: ['QUESTION_VERSION_NOT_FOUND'],
        details: [],
      });
    });

    it('is eligible for a well-formed, published, current, active version', async () => {
      findUnique.mockResolvedValue(baseVersion());
      const service = await createService();

      const result = await service.checkEligibility('v-1');

      expect(result.eligible).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('rejects a DRAFT version as QUESTION_NOT_PUBLISHED', async () => {
      findUnique.mockResolvedValue(baseVersion({ reviewStatus: 'DRAFT' }));
      const service = await createService();

      const result = await service.checkEligibility('v-1');

      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('QUESTION_NOT_PUBLISHED');
    });

    it('rejects a PUBLISHED version that is no longer the current published version', async () => {
      findUnique.mockResolvedValue(baseVersion({ question: { currentPublishedVersionId: 'v-2' } }));
      const service = await createService();

      const result = await service.checkEligibility('v-1');

      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('NOT_CURRENT_PUBLISHED_VERSION');
    });

    it('rejects an inactive version', async () => {
      findUnique.mockResolvedValue(baseVersion({ isActive: false }));
      const service = await createService();

      const result = await service.checkEligibility('v-1');

      expect(result.reasons).toContain('VERSION_INACTIVE');
    });

    it('rejects a version with fewer than two active options', async () => {
      findUnique.mockResolvedValue(
        baseVersion({ options: [{ content: 'Only one', isCorrect: true, isActive: true }] }),
      );
      const service = await createService();

      const result = await service.checkEligibility('v-1');

      expect(result.reasons).toContain('INSUFFICIENT_OPTIONS');
    });

    it('rejects a version with no correct option', async () => {
      findUnique.mockResolvedValue(
        baseVersion({
          options: [
            { content: 'A', isCorrect: false, isActive: true },
            { content: 'B', isCorrect: false, isActive: true },
          ],
        }),
      );
      const service = await createService();

      const result = await service.checkEligibility('v-1');

      expect(result.reasons).toContain('MISSING_CORRECT_OPTION');
    });

    it('rejects a version with more than one correct option', async () => {
      findUnique.mockResolvedValue(
        baseVersion({
          options: [
            { content: 'A', isCorrect: true, isActive: true },
            { content: 'B', isCorrect: true, isActive: true },
          ],
        }),
      );
      const service = await createService();

      const result = await service.checkEligibility('v-1');

      expect(result.reasons).toContain('MULTIPLE_CORRECT_OPTIONS');
    });

    it('rejects a version that fails the shared deterministic quality check', async () => {
      findUnique.mockResolvedValue(baseVersion({ stem: '   ' }));
      const service = await createService();

      const result = await service.checkEligibility('v-1');

      expect(result.reasons).toContain('QUALITY_CHECK_FAILED');
      expect(result.details.length).toBeGreaterThan(0);
    });

    it('ignores inactive options when counting correct answers', async () => {
      findUnique.mockResolvedValue(
        baseVersion({
          options: [
            { content: 'The investigator', isCorrect: true, isActive: true },
            { content: 'The sponsor', isCorrect: false, isActive: true },
            { content: 'Stale duplicate correct', isCorrect: true, isActive: false },
          ],
        }),
      );
      const service = await createService();

      const result = await service.checkEligibility('v-1');

      expect(result.eligible).toBe(true);
    });
  });

  describe('countEligible / listEligibleIds', () => {
    it('filters the coarse candidate set down to only truly eligible versions', async () => {
      findMany.mockResolvedValue([
        baseVersion({ id: 'v-1' }),
        baseVersion({ id: 'v-2', reviewStatus: 'DRAFT' }),
        baseVersion({ id: 'v-3', question: { currentPublishedVersionId: 'v-3' } }),
      ]);
      const service = await createService();

      const count = await service.countEligible({ levelId: 'level-1' });
      const ids = await service.listEligibleIds({ levelId: 'level-1' });

      expect(count).toBe(2);
      expect(ids).toEqual(['v-1', 'v-3']);
    });

    it('queries only PUBLISHED, active, current-version questions plus the given dimensions', async () => {
      findMany.mockResolvedValue([]);
      const service = await createService();

      await service.countEligible({
        levelId: 'level-1',
        domainId: 'dom-1',
        questionType: 'CASE_STUDY',
        difficulty: 'HARD',
      });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            reviewStatus: 'PUBLISHED',
            isActive: true,
            currentForQuestion: { isNot: null },
            levelId: 'level-1',
            domainId: 'dom-1',
            type: 'CASE_STUDY',
            difficulty: 'HARD',
          }),
        }),
      );
    });
  });
});
