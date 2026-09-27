import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { ExamBlueprintValidationService } from './exam-blueprint-validation.service';
import { ExamQuestionEligibilityService } from './exam-question-eligibility.service';

function baseVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-1',
    levelId: 'level-1',
    questionCount: 20,
    passPercentage: 80,
    totalMarks: 100,
    durationMinutes: 60,
    maxAttempts: 1,
    blueprint: {
      id: 'bp-1',
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
    ...overrides,
  };
}

describe('ExamBlueprintValidationService', () => {
  const examVersionFindUnique = jest.fn();
  const gcpDomainFindMany = jest.fn();
  const professionalRoleFindMany = jest.fn();
  const trainingLevelFindMany = jest.fn();
  const learningObjectiveFindMany = jest.fn();
  const countEligible = jest.fn();

  async function createService(): Promise<ExamBlueprintValidationService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExamBlueprintValidationService,
        {
          provide: PrismaService,
          useValue: {
            examVersion: { findUnique: examVersionFindUnique },
            gcpDomain: { findMany: gcpDomainFindMany },
            professionalRole: { findMany: professionalRoleFindMany },
            trainingLevel: { findMany: trainingLevelFindMany },
            learningObjective: { findMany: learningObjectiveFindMany },
          },
        },
        { provide: ExamQuestionEligibilityService, useValue: { countEligible } },
      ],
    }).compile();
    return moduleRef.get(ExamBlueprintValidationService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    gcpDomainFindMany.mockResolvedValue([]);
    professionalRoleFindMany.mockResolvedValue([]);
    trainingLevelFindMany.mockResolvedValue([]);
    learningObjectiveFindMany.mockResolvedValue([]);
    countEligible.mockResolvedValue(100);
  });

  it('is valid for a well-formed blueprint with a sufficient pool', async () => {
    examVersionFindUnique.mockResolvedValue(baseVersion());
    const service = await createService();

    const result = await service.validate('ev-1');

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when the exam version has no blueprint at all', async () => {
    examVersionFindUnique.mockResolvedValue(baseVersion({ blueprint: null }));
    const service = await createService();

    const result = await service.validate('ev-1');

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /no blueprint configured/i.test(e))).toBe(true);
  });

  it('flags questionCount <= 0', async () => {
    examVersionFindUnique.mockResolvedValue(baseVersion({ questionCount: 0 }));
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /questionCount must be greater than zero/i.test(e))).toBe(
      true,
    );
  });

  it('flags an invalid passPercentage', async () => {
    examVersionFindUnique.mockResolvedValue(baseVersion({ passPercentage: 150 }));
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /passPercentage/i.test(e))).toBe(true);
  });

  it('flags a rule with no constraining dimension at all', async () => {
    examVersionFindUnique.mockResolvedValue(
      baseVersion({
        blueprint: {
          id: 'bp-1',
          rules: [
            {
              id: 'rule-1',
              questionType: null,
              difficulty: null,
              domainId: null,
              professionalRoleId: null,
              levelId: null,
              learningObjectiveId: null,
              caseStudyRequired: null,
              sourceRequired: null,
              minimumCount: 2,
              maximumCount: null,
              exactCount: null,
              isActive: true,
            },
          ],
        },
      }),
    );
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /constrain no dimension/i.test(e))).toBe(true);
  });

  it('flags a contradictory exactCount alongside a conflicting minimumCount', async () => {
    examVersionFindUnique.mockResolvedValue(
      baseVersion({
        blueprint: {
          id: 'bp-1',
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
              minimumCount: 3,
              maximumCount: null,
              exactCount: 5,
              isActive: true,
            },
          ],
        },
      }),
    );
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /exactCount together with a conflicting/i.test(e))).toBe(true);
  });

  it('flags minimumCount greater than maximumCount', async () => {
    examVersionFindUnique.mockResolvedValue(
      baseVersion({
        blueprint: {
          id: 'bp-1',
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
              minimumCount: 10,
              maximumCount: 5,
              exactCount: null,
              isActive: true,
            },
          ],
        },
      }),
    );
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /minimumCount greater than maximumCount/i.test(e))).toBe(true);
  });

  it('flags the sum of exactCount rules exceeding questionCount', async () => {
    examVersionFindUnique.mockResolvedValue(
      baseVersion({
        questionCount: 10,
        blueprint: {
          id: 'bp-1',
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
              minimumCount: null,
              maximumCount: null,
              exactCount: 8,
              isActive: true,
            },
            {
              id: 'rule-2',
              questionType: 'SCENARIO',
              difficulty: null,
              domainId: null,
              professionalRoleId: null,
              levelId: null,
              learningObjectiveId: null,
              caseStudyRequired: null,
              sourceRequired: null,
              minimumCount: null,
              maximumCount: null,
              exactCount: 8,
              isActive: true,
            },
          ],
        },
      }),
    );
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /exactCount across active rules/i.test(e))).toBe(true);
  });

  it('flags duplicate rules with identical dimension signatures', async () => {
    const rule = {
      id: 'rule-1',
      questionType: 'CASE_STUDY',
      difficulty: null,
      domainId: null,
      professionalRoleId: null,
      levelId: null,
      learningObjectiveId: null,
      caseStudyRequired: null,
      sourceRequired: null,
      minimumCount: 2,
      maximumCount: null,
      exactCount: null,
      isActive: true,
    };
    examVersionFindUnique.mockResolvedValue(
      baseVersion({ blueprint: { id: 'bp-1', rules: [rule, { ...rule, id: 'rule-2' }] } }),
    );
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /duplicate another rule/i.test(e))).toBe(true);
  });

  it('flags a reference to a GCP domain that no longer exists', async () => {
    examVersionFindUnique.mockResolvedValue(
      baseVersion({
        blueprint: {
          id: 'bp-1',
          rules: [
            {
              id: 'rule-1',
              questionType: null,
              difficulty: null,
              domainId: 'missing-domain',
              professionalRoleId: null,
              levelId: null,
              learningObjectiveId: null,
              caseStudyRequired: null,
              sourceRequired: null,
              minimumCount: 2,
              maximumCount: null,
              exactCount: null,
              isActive: true,
            },
          ],
        },
      }),
    );
    gcpDomainFindMany.mockResolvedValue([]);
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /GCP domain that no longer exists/i.test(e))).toBe(true);
  });

  it('fails when the overall eligible pool is smaller than questionCount', async () => {
    countEligible.mockResolvedValue(3);
    examVersionFindUnique.mockResolvedValue(baseVersion({ questionCount: 20 }));
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Only 3 eligible published question/i.test(e))).toBe(true);
  });

  it('fails when a mandatory rule has an insufficient eligible pool', async () => {
    countEligible.mockImplementation((filter: { questionType?: string }) =>
      Promise.resolve(filter.questionType === 'CASE_STUDY' ? 2 : 100),
    );
    examVersionFindUnique.mockResolvedValue(baseVersion());
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /requires 4 eligible question/i.test(e))).toBe(true);
  });

  it('warns but does not fail when a blueprint has no active rules', async () => {
    examVersionFindUnique.mockResolvedValue(baseVersion({ blueprint: { id: 'bp-1', rules: [] } }));
    const service = await createService();

    const result = await service.validate('ev-1');
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => /no active rules/i.test(w))).toBe(true);
  });
});
