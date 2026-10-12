import { HttpStatus } from '@nestjs/common';

import { ExamErrorCode } from '@gcp/shared';

import { AppException } from '../../../common/exceptions/app-exception';
import { type PrismaService } from '../../../prisma/prisma.service';

/**
 * Gate 24 §3 identified the registered ICH E6(R3) authority by
 * `SourceVersion.documentIdentifier === 'E6(R3)'`. Gate 25 reuses that exact
 * identification here rather than a second, parallel definition - both
 * `QuestionBankSufficiencyService` (Gate 24) and `ExamBlueprintService`/
 * `ExamBlueprintValidationService` (Gate 25) import this same file.
 */
export const ICH_DOCUMENT_IDENTIFIER = 'E6(R3)';

export interface IchAuthoritySourceVersion {
  id: string;
  sourceId: string;
}

/** Every `SourceVersion` row claiming to be ICH E6(R3), regardless of its
 * publication/authority status - callers decide what "authoritative" means
 * for their purpose (Gate 24's audit reports duplicates; Gate 25's
 * validation below requires exactly one, PUBLISHED, AUTHORITATIVE_REGULATORY). */
export async function findIchE6R3SourceVersions(
  prisma: PrismaService,
): Promise<IchAuthoritySourceVersion[]> {
  return prisma.sourceVersion.findMany({
    where: { documentIdentifier: ICH_DOCUMENT_IDENTIFIER },
    select: { id: true, sourceId: true },
  });
}

/**
 * Gate 29: the ONE SourceVersion learners actually read - the registered
 * ICH E6(R3) Source's own `currentPublishedVersionId` (never merely "any
 * SourceVersion with this documentIdentifier", since a superseded version
 * must never become the live training material). Throws the same
 * `BLUEPRINT_NORMATIVE_SECTION_INVALID`-style failure mode as
 * {@link assertNormativeSectionIsIchAuthoritative} if no such version is
 * currently published and authoritative.
 */
export async function findCurrentIchE6R3SourceVersion(
  prisma: PrismaService,
): Promise<{ id: string; sourceId: string }> {
  const version = await prisma.sourceVersion.findFirst({
    where: {
      documentIdentifier: ICH_DOCUMENT_IDENTIFIER,
      reviewStatus: 'PUBLISHED',
      authority: 'AUTHORITATIVE_REGULATORY',
      currentForSource: { isNot: null },
    },
    select: { id: true, sourceId: true },
  });
  if (!version) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ExamErrorCode.BLUEPRINT_NORMATIVE_SECTION_INVALID,
      'The registered ICH E6(R3) source has no currently published, authoritative version.',
    );
  }
  return version;
}

/**
 * Gate 25 §5: the full normative-section acceptance check. Throws
 * `BLUEPRINT_NORMATIVE_SECTION_INVALID` (never leaking which sub-check
 * failed, or any other database detail) unless the section:
 * 1. exists,
 * 2. belongs to a `SourceVersion` whose `documentIdentifier` is the
 *    registered ICH E6(R3) identifier,
 * 3. that `SourceVersion` is `PUBLISHED`,
 * 4. that `SourceVersion`'s `authority` is `AUTHORITATIVE_REGULATORY`.
 *
 * Never accepts an arbitrary UUID merely because a `SourceSection` row with
 * that id exists - every one of the four checks above must hold.
 */
export async function assertNormativeSectionIsIchAuthoritative(
  prisma: PrismaService,
  sourceSectionId: string,
): Promise<void> {
  const section = await prisma.sourceSection.findUnique({
    where: { id: sourceSectionId },
    select: {
      sourceVersion: {
        select: { documentIdentifier: true, reviewStatus: true, authority: true },
      },
    },
  });

  const valid =
    section !== null &&
    section.sourceVersion.documentIdentifier === ICH_DOCUMENT_IDENTIFIER &&
    section.sourceVersion.reviewStatus === 'PUBLISHED' &&
    section.sourceVersion.authority === 'AUTHORITATIVE_REGULATORY';

  if (!valid) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ExamErrorCode.BLUEPRINT_NORMATIVE_SECTION_INVALID,
      'The referenced normative section must belong to the registered, published, authoritative ICH E6(R3) source.',
    );
  }
}
