import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { ExamQuestionEligibilityService } from '../../admin/exams/exam-question-eligibility.service';
import {
  BlueprintSelectionError,
  ExamQuestionSelectionService,
} from './exam-question-selection.service';

const EXAM_VERSION = {
  id: 'ev-1',
  levelId: 'level-1',
  questionCount: 2,
  blueprint: {
    rules: [
      {
        id: 'rule-1',
        isActive: true,
        exactCount: 2,
        minimumCount: null,
        maximumCount: null,
        questionType: null,
        difficulty: null,
        domainId: null,
        professionalRoleId: null,
        levelId: null,
        learningObjectiveId: null,
        caseStudyRequired: null,
        sourceRequired: null,
        normativeSourceSectionId: null,
        questionGenerationType: null,
      },
    ],
  },
};

function candidate(id: string) {
  return {
    id,
    type: 'KNOWLEDGE' as const,
    difficulty: 'MEDIUM' as const,
    domainId: null,
    professionalRoleId: null,
    levelId: 'level-1',
    learningObjectiveId: null,
    hasCaseStudy: false,
    hasSource: false,
    sourceSectionRefId: null,
    questionGenerationType: null,
    optionIds: [`${id}-opt-a`, `${id}-opt-b`],
  };
}

describe('ExamQuestionSelectionService', () => {
  const examVersionFindUnique = jest.fn();
  const listEligible = jest.fn();
  const examAttemptQuestionFindMany = jest.fn();

  async function createService(): Promise<ExamQuestionSelectionService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExamQuestionSelectionService,
        {
          provide: PrismaService,
          useValue: {
            examVersion: { findUnique: examVersionFindUnique },
            examAttemptQuestion: { findMany: examAttemptQuestionFindMany },
          },
        },
        { provide: ExamQuestionEligibilityService, useValue: { listEligible } },
      ],
    }).compile();
    return moduleRef.get(ExamQuestionSelectionService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    examVersionFindUnique.mockResolvedValue(EXAM_VERSION);
  });

  it('selects only from the unseen pool when it alone satisfies the blueprint (Gate 29 §15)', async () => {
    listEligible.mockResolvedValue([candidate('qv-1'), candidate('qv-2'), candidate('qv-3')]);
    examAttemptQuestionFindMany.mockResolvedValue([{ questionVersionId: 'qv-1' }]);

    const service = await createService();
    const result = await service.select('ev-1', 'user-1');

    expect(result.orderedQuestionVersionIds).toHaveLength(2);
    expect(result.orderedQuestionVersionIds).not.toContain('qv-1');
    expect(result.reusedQuestionIds).toEqual([]);
  });

  it('falls back to the full pool and reports reusedQuestionIds when the unseen pool is insufficient', async () => {
    listEligible.mockResolvedValue([candidate('qv-1'), candidate('qv-2')]);
    // Both candidates already seen - the unseen pool is empty, so the
    // blueprint (exactCount 2) cannot be satisfied from it alone.
    examAttemptQuestionFindMany.mockResolvedValue([
      { questionVersionId: 'qv-1' },
      { questionVersionId: 'qv-2' },
    ]);

    const service = await createService();
    const result = await service.select('ev-1', 'user-1');

    expect(new Set(result.orderedQuestionVersionIds)).toEqual(new Set(['qv-1', 'qv-2']));
    expect(new Set(result.reusedQuestionIds)).toEqual(new Set(['qv-1', 'qv-2']));
  });

  it('never selects the same QuestionVersion twice within one attempt, even after falling back to the full pool', async () => {
    listEligible.mockResolvedValue([candidate('qv-1'), candidate('qv-2')]);
    examAttemptQuestionFindMany.mockResolvedValue([
      { questionVersionId: 'qv-1' },
      { questionVersionId: 'qv-2' },
    ]);

    const service = await createService();
    const result = await service.select('ev-1', 'user-1');

    expect(new Set(result.orderedQuestionVersionIds).size).toBe(
      result.orderedQuestionVersionIds.length,
    );
  });

  it('throws BlueprintSelectionError when even the full pool cannot satisfy the blueprint', async () => {
    listEligible.mockResolvedValue([candidate('qv-1')]);
    examAttemptQuestionFindMany.mockResolvedValue([]);

    const service = await createService();
    await expect(service.select('ev-1', 'user-1')).rejects.toBeInstanceOf(BlueprintSelectionError);
  });
});
