import { NotFoundException } from '@nestjs/common';

import { type Prisma } from '@prisma/client';

import { type PrismaService } from '../../../prisma/prisma.service';

const EXAM_WITH_LATEST_VERSION = {
  versions: { orderBy: { versionNumber: 'desc' as const }, take: 1 },
} satisfies Prisma.ExamInclude;

type ExamWithLatestVersion = Prisma.ExamGetPayload<{ include: typeof EXAM_WITH_LATEST_VERSION }>;

/**
 * Every admin exam endpoint operates on the exam's LATEST version (mirroring
 * how the Stage 6 question endpoints always operate on `versions[0]`) -
 * older versions remain queryable through the version history but are never
 * the implicit target of an edit or transition.
 */
export async function loadLatestExamVersion(
  prisma: PrismaService,
  examId: string,
): Promise<{
  exam: ExamWithLatestVersion;
  latest: ExamWithLatestVersion['versions'][number];
}> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: EXAM_WITH_LATEST_VERSION,
  });
  const latest = exam?.versions[0];
  if (!exam || !latest) {
    throw new NotFoundException('Exam not found');
  }
  return { exam, latest };
}
