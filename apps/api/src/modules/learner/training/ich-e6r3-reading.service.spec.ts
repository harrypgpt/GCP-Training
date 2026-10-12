import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../prisma/prisma.service';
import { IchE6R3ReadingService } from './ich-e6r3-reading.service';

jest.mock('../../admin/exams/ich-e6r3-authority.util', () => ({
  findCurrentIchE6R3SourceVersion: jest
    .fn()
    .mockResolvedValue({ id: 'sv-2', sourceId: 'source-1' }),
}));

const SECTIONS = [
  { sectionIdentifier: 'I', heading: 'Introduction', depth: 0, sequence: 0, content: 'Intro text' },
  {
    sectionIdentifier: 'II',
    heading: 'Principles',
    depth: 0,
    sequence: 1,
    content: 'Principles text',
  },
  {
    sectionIdentifier: 'II.1',
    heading: 'Principle 1',
    depth: 1,
    sequence: 2,
    content: 'Principle 1 text',
  },
];

describe('IchE6R3ReadingService', () => {
  const sourceFindUniqueOrThrow = jest.fn();
  const sourceVersionFindMany = jest.fn();
  const sourceVersionFindUniqueOrThrow = jest.fn();
  const progressFindUnique = jest.fn();
  const progressCreate = jest.fn();
  const progressUpdate = jest.fn();
  const progressUpdateMany = jest.fn();

  async function createService(): Promise<IchE6R3ReadingService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IchE6R3ReadingService,
        {
          provide: PrismaService,
          useValue: {
            source: { findUniqueOrThrow: sourceFindUniqueOrThrow },
            sourceVersion: {
              findMany: sourceVersionFindMany,
              findUniqueOrThrow: sourceVersionFindUniqueOrThrow,
            },
            sourceSection: { findMany: sourceVersionFindMany },
            sourceReadingProgress: {
              findUnique: progressFindUnique,
              create: progressCreate,
              update: progressUpdate,
              updateMany: progressUpdateMany,
            },
          },
        },
      ],
    }).compile();
    return moduleRef.get(IchE6R3ReadingService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    sourceFindUniqueOrThrow.mockResolvedValue({ title: 'ICH E6(R3) Guideline' });
    sourceVersionFindUniqueOrThrow.mockResolvedValue({
      documentVersion: 'Final Version',
      effectiveDate: new Date('2025-01-06'),
      license: 'ICH copyright',
      attributionRequired: true,
    });
    sourceVersionFindMany.mockResolvedValue(SECTIONS);
  });

  it('reports NOT_STARTED with 0 progress for a learner who has never opened the reader', async () => {
    progressFindUnique.mockResolvedValue(null);
    progressCreate.mockResolvedValue({
      status: 'NOT_STARTED',
      lastViewedSequence: 0,
      trainingStartedAt: null,
      trainingCompletedAt: null,
    });

    const service = await createService();
    const overview = await service.getOverview('user-1');

    expect(overview.progress.status).toBe('NOT_STARTED');
    expect(overview.tableOfContents).toHaveLength(3);
  });

  it('marks training COMPLETED only once the learner reaches the last section (never by page count or elapsed time)', async () => {
    progressFindUnique.mockResolvedValue({
      status: 'IN_PROGRESS',
      lastViewedSequence: 0,
      trainingStartedAt: new Date(),
      trainingCompletedAt: null,
    });
    progressUpdate.mockResolvedValue({
      status: 'COMPLETED',
      lastViewedSequence: 2,
      trainingStartedAt: new Date(),
      trainingCompletedAt: new Date(),
    });

    const service = await createService();
    // Reads the LAST section (sequence 2 of 0..2)
    const view = await service.getSection('user-1', 2);

    expect(view.isLast).toBe(true);
    expect(progressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it('does NOT mark training complete for reading any page short of the last one', async () => {
    progressFindUnique.mockResolvedValue({
      status: 'NOT_STARTED',
      lastViewedSequence: 0,
      trainingStartedAt: null,
      trainingCompletedAt: null,
    });
    progressUpdate.mockResolvedValue({
      status: 'IN_PROGRESS',
      lastViewedSequence: 1,
      trainingStartedAt: new Date(),
      trainingCompletedAt: null,
    });

    const service = await createService();
    const view = await service.getSection('user-1', 1);

    expect(view.isLast).toBe(false);
    expect(progressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_PROGRESS' }),
      }),
    );
  });

  it('isTrainingComplete is true only when status is exactly COMPLETED', async () => {
    progressFindUnique.mockResolvedValue({ status: 'RETRAINING_REQUIRED' });
    const service = await createService();
    expect(await service.isTrainingComplete('user-1')).toBe(false);

    progressFindUnique.mockResolvedValue({ status: 'COMPLETED' });
    expect(await service.isTrainingComplete('user-1')).toBe(true);
  });

  it('requireRetraining flips a COMPLETED learner back to RETRAINING_REQUIRED, never touching other statuses', async () => {
    const service = await createService();
    await service.requireRetraining('user-1');

    expect(progressUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', sourceVersionId: 'sv-2', status: 'COMPLETED' },
      data: { status: 'RETRAINING_REQUIRED' },
    });
  });
});
