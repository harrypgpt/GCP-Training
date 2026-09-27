import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { QuestionDuplicatesService } from './question-duplicates.service';

describe('QuestionDuplicatesService.summarize (Gate 24 §10)', () => {
  const findMany = jest.fn();

  async function createService(): Promise<QuestionDuplicatesService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuestionDuplicatesService,
        { provide: PrismaService, useValue: { questionDuplicateFlag: { findMany } } },
      ],
    }).compile();
    return moduleRef.get(QuestionDuplicatesService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports zero counts when no flag has ever been recorded', async () => {
    findMany.mockResolvedValue([]);
    const service = await createService();
    const result = await service.summarize();
    expect(result).toEqual({ byMatchType: {}, unresolvedCount: 0, resolvedCount: 0 });
  });

  it('splits resolved from unresolved and tallies by match type, without resolving or deleting anything', async () => {
    findMany.mockResolvedValue([
      { matchType: 'EXACT_STEM', resolvedAt: null },
      { matchType: 'EXACT_STEM', resolvedAt: new Date() },
      { matchType: 'DUPLICATE_OPTION_SET', resolvedAt: null },
    ]);
    const service = await createService();
    const result = await service.summarize();
    expect(result).toEqual({
      byMatchType: { EXACT_STEM: 2, DUPLICATE_OPTION_SET: 1 },
      unresolvedCount: 2,
      resolvedCount: 1,
    });
  });
});
