import { Injectable, Logger } from '@nestjs/common';

import { ContentStatus, DuplicateMatchType, Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

function normalizeStem(stem: string): string {
  return stem.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeOptionSet(contents: string[]): string {
  return contents
    .map((c) => c.trim().toLowerCase().replace(/\s+/g, ' '))
    .sort()
    .join('|');
}

/**
 * Mechanical (non-semantic) duplicate detection — Stage 6 spec §19
 * explicitly scopes this to basic checks (same code is enforced by the DB
 * unique constraint already; this covers exact-stem and identical-option-set
 * matches) and explicitly defers real semantic similarity to a future stage.
 * Findings are recorded, never auto-resolved or auto-deleted.
 */
@Injectable()
export class QuestionDuplicatesService {
  private readonly logger = new Logger(QuestionDuplicatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort: a failure here must never break the caller's workflow transition. */
  async detectAndFlag(versionId: string): Promise<void> {
    try {
      await this.run(versionId);
    } catch (error) {
      this.logger.error(
        `Duplicate detection failed for question version ${versionId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async run(versionId: string): Promise<void> {
    const version = await this.prisma.questionVersion.findUnique({
      where: { id: versionId },
      include: { options: true },
    });
    if (!version) {
      return;
    }

    const candidateIdRows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (question_id) id
      FROM question_versions
      WHERE question_id != ${version.questionId}::uuid
        AND review_status != ${ContentStatus.ARCHIVED}::content_status
      ORDER BY question_id, version_number DESC
    `;
    if (candidateIdRows.length === 0) {
      return;
    }

    const candidates = await this.prisma.questionVersion.findMany({
      where: { id: { in: candidateIdRows.map((r) => r.id) } },
      include: { options: true },
    });

    const thisStem = normalizeStem(version.stem);
    const thisOptionSet = normalizeOptionSet(version.options.map((o) => o.content));

    for (const candidate of candidates) {
      const matches: DuplicateMatchType[] = [];
      if (normalizeStem(candidate.stem) === thisStem) {
        matches.push(DuplicateMatchType.EXACT_STEM);
      }
      if (normalizeOptionSet(candidate.options.map((o) => o.content)) === thisOptionSet) {
        matches.push(DuplicateMatchType.DUPLICATE_OPTION_SET);
      }

      for (const matchType of matches) {
        await this.flag(version.id, candidate.id, matchType);
      }
    }
  }

  private async flag(
    versionId: string,
    candidateId: string,
    matchType: DuplicateMatchType,
  ): Promise<void> {
    // Order deterministically so the same pair is never stored twice under
    // swapped column order.
    const [versionAId, versionBId] = [versionId, candidateId].sort();

    try {
      await this.prisma.questionDuplicateFlag.create({
        data: { versionAId: versionAId!, versionBId: versionBId!, matchType },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Already flagged (and possibly already resolved) — never re-raise a
        // known duplicate as new noise.
        return;
      }
      throw error;
    }
  }
}
