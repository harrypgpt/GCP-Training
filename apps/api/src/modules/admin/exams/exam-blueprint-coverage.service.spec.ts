import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { ExamBlueprintCoverageService } from './exam-blueprint-coverage.service';
import { ExamQuestionEligibilityService } from './exam-question-eligibility.service';

describe('ExamBlueprintCoverageService', () => {
  const examVersionFindUnique = jest.fn();
  const countEligible = jest.fn();

  async function createService(): Promise<ExamBlueprintCoverageService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExamBlueprintCoverageService,
        {
          provide: PrismaService,
          useValue: { examVersion: { findUnique: examVersionFindUnique } },
        },
        { provide: ExamQuestionEligibilityService, useValue: { countEligible } },
      ],
    }).compile();
    return moduleRef.get(ExamBlueprintCoverageService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws NotFoundException for an unknown exam version', async () => {
    examVersionFindUnique.mockResolvedValue(null);
    const service = await createService();

    await expect(service.analyze('missing')).rejects.toThrow('Exam version not found');
  });

  it('reports feasible when the overall pool and every rule are sufficient', async () => {
    examVersionFindUnique.mockResolvedValue({
      id: 'ev-1',
      levelId: 'level-1',
      questionCount: 20,
      blueprint: {
        rules: [
          {
            id: 'rule-1',
            questionType: 'CASE_STUDY',
            difficulty: null,
            domainId: null,
            professionalRoleId: null,
            levelId: null,
            learningObjectiveId: null,
            caseStudyRequired: null,
            sourceRequired: null,
            minimumCount: 4,
            maximumCount: 6,
            exactCount: null,
            isActive: true,
          },
        ],
      },
    });
    countEligible.mockResolvedValue(50);
    const service = await createService();

    const result = await service.analyze('ev-1');

    expect(result).toMatchObject({
      examVersionId: 'ev-1',
      questionCountRequired: 20,
      eligiblePoolSize: 50,
      feasible: true,
    });
    expect(result.rules).toEqual([
      {
        ruleId: 'rule-1',
        description: 'type=CASE_STUDY',
        minimumCount: 4,
        maximumCount: 6,
        exactCount: null,
        required: 4,
        eligiblePool: 50,
        shortfall: 0,
        sufficient: true,
      },
    ]);
    expect(result.questionCountShortfall).toBe(0);
  });

  it('reports infeasible when a rule cannot meet its minimum count', async () => {
    examVersionFindUnique.mockResolvedValue({
      id: 'ev-1',
      levelId: 'level-1',
      questionCount: 20,
      blueprint: {
        rules: [
          {
            id: 'rule-1',
            questionType: 'CASE_STUDY',
            difficulty: null,
            domainId: null,
            professionalRoleId: null,
            levelId: null,
            learningObjectiveId: null,
            caseStudyRequired: null,
            sourceRequired: null,
            minimumCount: 4,
            maximumCount: 6,
            exactCount: null,
            isActive: true,
          },
        ],
      },
    });
    countEligible.mockImplementation((filter: { questionType?: string }) =>
      Promise.resolve(filter.questionType === 'CASE_STUDY' ? 2 : 50),
    );
    const service = await createService();

    const result = await service.analyze('ev-1');

    expect(result.feasible).toBe(false);
    expect(result.rules[0]).toMatchObject({
      eligiblePool: 2,
      required: 4,
      shortfall: 2,
      sufficient: false,
    });
  });

  it('ignores inactive rules', async () => {
    examVersionFindUnique.mockResolvedValue({
      id: 'ev-1',
      levelId: 'level-1',
      questionCount: 20,
      blueprint: {
        rules: [
          {
            id: 'rule-1',
            questionType: 'CASE_STUDY',
            difficulty: null,
            domainId: null,
            professionalRoleId: null,
            levelId: null,
            learningObjectiveId: null,
            caseStudyRequired: null,
            sourceRequired: null,
            minimumCount: 100,
            maximumCount: null,
            exactCount: null,
            isActive: false,
          },
        ],
      },
    });
    countEligible.mockResolvedValue(50);
    const service = await createService();

    const result = await service.analyze('ev-1');

    expect(result.rules).toEqual([]);
    expect(result.feasible).toBe(true);
  });

  it('is infeasible when the overall pool is smaller than questionCount even with no rules', async () => {
    examVersionFindUnique.mockResolvedValue({
      id: 'ev-1',
      levelId: 'level-1',
      questionCount: 20,
      blueprint: { rules: [] },
    });
    countEligible.mockResolvedValue(5);
    const service = await createService();

    const result = await service.analyze('ev-1');

    expect(result.feasible).toBe(false);
  });
});
