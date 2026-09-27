import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditAction, ObservationErrorCode } from '@gcp/shared';
import { ContentStatus } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { type CreateSourceLinkReviewDto } from './dto/create-source-link-review.dto';
import { type DecideSourceLinkReviewDto } from './dto/decide-source-link-review.dto';

export interface SourceLinkReviewResult {
  id: string;
  observationVersionId: string;
  citationText: string;
  candidateSourceId: string | null;
  candidateSourceVersionId: string | null;
  candidateSourceSectionId: string | null;
  status: string;
  rationale: string | null;
  reviewerId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

function reviewNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ObservationErrorCode.SOURCE_LINK_REVIEW_NOT_FOUND,
    'Source-link review not found.',
  );
}

/**
 * Gate 13 §17/§18: registers candidate regulatory citations found in an
 * observation's evidence and their human review decision. Never
 * auto-verifies a link from pattern matching - VERIFIED only ever results
 * from an explicit reviewer decision.
 */
@Injectable()
export class ObservationSourceLinkReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createReview(
    versionId: string,
    dto: CreateSourceLinkReviewDto,
    actorId: string,
  ): Promise<SourceLinkReviewResult> {
    const version = await this.prisma.observationVersion.findUnique({ where: { id: versionId } });
    if (!version) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
        'Observation version not found.',
      );
    }
    this.assertEditable(version.reviewStatus);

    if (dto.candidateSourceId) {
      const source = await this.prisma.source.findUnique({ where: { id: dto.candidateSourceId } });
      if (!source) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ObservationErrorCode.DOMAIN_NOT_FOUND,
          'Candidate source not found.',
        );
      }
    }

    const review = await this.prisma.observationSourceLinkReview.create({
      data: {
        observationVersionId: versionId,
        citationText: dto.citationText,
        ...(dto.candidateSourceId ? { candidateSourceId: dto.candidateSourceId } : {}),
        ...(dto.candidateSourceVersionId
          ? { candidateSourceVersionId: dto.candidateSourceVersionId }
          : {}),
        ...(dto.candidateSourceSectionId
          ? { candidateSourceSectionId: dto.candidateSourceSectionId }
          : {}),
      },
    });

    await this.audit.record({
      action: AuditAction.OBSERVATION_SOURCE_LINK_REVIEW_CREATED,
      entity: 'observation_source_link_review',
      entityId: review.id,
      actorId,
      metadata: { observationVersionId: versionId, citationText: dto.citationText },
    });

    return review;
  }

  async listForVersion(versionId: string): Promise<SourceLinkReviewResult[]> {
    const exists = await this.prisma.observationVersion.findUnique({ where: { id: versionId } });
    if (!exists) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
        'Observation version not found.',
      );
    }
    return this.prisma.observationSourceLinkReview.findMany({
      where: { observationVersionId: versionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async decideReview(
    versionId: string,
    reviewId: string,
    dto: DecideSourceLinkReviewDto,
    actorId: string,
  ): Promise<SourceLinkReviewResult> {
    const review = await this.prisma.observationSourceLinkReview.findUnique({
      where: { id: reviewId },
    });
    if (!review || review.observationVersionId !== versionId) {
      throw reviewNotFound();
    }
    const version = await this.prisma.observationVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    this.assertEditable(version.reviewStatus);

    const updated = await this.prisma.observationSourceLinkReview.update({
      where: { id: reviewId },
      data: {
        status: dto.status,
        ...(dto.rationale ? { rationale: dto.rationale } : {}),
        reviewerId: actorId,
        reviewedAt: new Date(),
      },
    });

    await this.audit.record({
      action: AuditAction.OBSERVATION_SOURCE_LINK_REVIEW_DECIDED,
      entity: 'observation_source_link_review',
      entityId: reviewId,
      actorId,
      metadata: { observationVersionId: versionId, status: dto.status },
    });

    return updated;
  }

  private assertEditable(reviewStatus: ContentStatus): void {
    if (reviewStatus === ContentStatus.PUBLISHED || reviewStatus === ContentStatus.ARCHIVED) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ObservationErrorCode.CURATION_NOT_EDITABLE,
        'A published or archived observation version is immutable. Create a new version for any correction.',
      );
    }
  }
}
