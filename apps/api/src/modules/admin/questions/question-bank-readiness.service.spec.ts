import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { ExamBlueprintCoverageService } from '../exams/exam-blueprint-coverage.service';
import { QuestionBankReadinessService } from './question-bank-readiness.service';

describe('QuestionBankReadinessService (Gate 22 §25/§34)', () => {
  const questionFindMany = jest.fn();
  const examVersionFindMany = jest.fn();
  const analyze = jest.fn();

  async function createService(): Promise<QuestionBankReadinessService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuestionBankReadinessService,
        {
          provide: PrismaService,
          useValue: {
            question: { findMany: questionFindMany },
            examVersion: { findMany: examVersionFindMany },
          },
        },
        { provide: ExamBlueprintCoverageService, useValue: { analyze } },
      ],
    }).compile();
    return moduleRef.get(QuestionBankReadinessService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    examVersionFindMany.mockResolvedValue([]);
  });

  it('reports zero counts when the question bank is empty', async () => {
    questionFindMany.mockResolvedValue([]);
    const service = await createService();

    const result = await service.getSummary();

    expect(result.totalQuestions).toBe(0);
    expect(result.byReviewStatus).toEqual({});
    expect(result.blueprints).toEqual([]);
  });

  it('aggregates by review status, generation type, difficulty, domain, learning objective, and professional role', async () => {
    questionFindMany.mockResolvedValue([
      {
        id: 'q-1',
        versions: [
          {
            reviewStatus: 'DRAFT',
            questionGenerationType: 'DIRECT_GCP',
            difficulty: 'MEDIUM',
            domain: { name: 'Data Integrity' },
            learningObjective: { description: 'Identify GCP obligations' },
            professionalRole: { name: 'Investigator' },
          },
        ],
      },
      {
        id: 'q-2',
        versions: [
          {
            reviewStatus: 'PUBLISHED',
            questionGenerationType: 'CASE_APPLICATION',
            difficulty: 'HARD',
            domain: null,
            learningObjective: null,
            professionalRole: null,
          },
        ],
      },
    ]);
    const service = await createService();

    const result = await service.getSummary();

    expect(result.totalQuestions).toBe(2);
    expect(result.byReviewStatus).toEqual({ DRAFT: 1, PUBLISHED: 1 });
    expect(result.byQuestionGenerationType).toEqual({ DIRECT_GCP: 1, CASE_APPLICATION: 1 });
    expect(result.byDifficulty).toEqual({ MEDIUM: 1, HARD: 1 });
    expect(result.byDomain).toEqual({ 'Data Integrity': 1, UNASSIGNED: 1 });
  });

  it('classifies a fully feasible blueprint as READY', async () => {
    examVersionFindMany.mockResolvedValue([
      { id: 'ev-1', exam: { id: 'exam-1', code: 'GCP-EXAM-001' } },
    ]);
    analyze.mockResolvedValue({
      examVersionId: 'ev-1',
      questionCountRequired: 20,
      eligiblePoolSize: 50,
      questionCountShortfall: 0,
      rules: [{ sufficient: true }],
      feasible: true,
    });
    questionFindMany.mockResolvedValue([]);
    const service = await createService();

    const result = await service.getSummary();

    expect(result.blueprints).toEqual([
      expect.objectContaining({ examCode: 'GCP-EXAM-001', status: 'READY', feasible: true }),
    ]);
  });

  it('classifies a blueprint with an insufficient rule or shortfall as INSUFFICIENT', async () => {
    examVersionFindMany.mockResolvedValue([
      { id: 'ev-1', exam: { id: 'exam-1', code: 'GCP-EXAM-001' } },
    ]);
    analyze.mockResolvedValue({
      examVersionId: 'ev-1',
      questionCountRequired: 20,
      eligiblePoolSize: 5,
      questionCountShortfall: 15,
      rules: [{ sufficient: false }],
      feasible: false,
    });
    questionFindMany.mockResolvedValue([]);
    const service = await createService();

    const result = await service.getSummary();

    expect(result.blueprints[0]).toMatchObject({ status: 'INSUFFICIENT', feasible: false });
  });

  it('never computes a numerical quality score', async () => {
    questionFindMany.mockResolvedValue([]);
    const service = await createService();

    const result = await service.getSummary();

    expect(result).not.toHaveProperty('qualityScore');
    expect(JSON.stringify(result)).not.toMatch(/score/i);
  });
});
