import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AiErrorCode, AuditAction } from '@gcp/shared';
import { Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildPaginatedResult,
  paginationSkipTake,
  type PaginatedResult,
} from '../admin/common/pagination';
import { type ListCandidatesQueryDto } from './dto/list-candidates.query.dto';

export const CANDIDATE_INCLUDE = {
  options: { orderBy: { sortOrder: 'asc' } },
  caseStudyLinks: { include: { caseStudy: { select: { id: true, caseCode: true, title: true } } } },
  level: { select: { id: true, name: true } },
  domain: { select: { id: true, name: true } },
  professionalRole: { select: { id: true, name: true } },
  learningObjective: { select: { id: true, description: true } },
  source: { select: { id: true, title: true } },
  observation: { select: { id: true, observationCode: true, description: true } },
  reviewer: { select: { id: true, email: true } },
  // Gate 18: the candidate's normative ICH E6(R3) reference and the
  // case-study version it was scenario-grounded on (Gate 17), included so
  // the review UI can show real, human-readable labels rather than bare IDs.
  normativeSourceVersion: {
    select: { id: true, documentIdentifier: true, documentVersion: true, reviewStatus: true },
  },
  normativeSourceSection: { select: { id: true, sectionIdentifier: true, heading: true } },
  caseStudyVersion: { select: { id: true, title: true, caseStudyId: true } },
  run: {
    select: {
      id: true,
      operation: true,
      provider: true,
      model: true,
      status: true,
      promptTemplateVersion: true,
      groundingVersion: true,
      outputSchemaVersion: true,
      initiatedBy: { select: { id: true, email: true } },
      createdAt: true,
    },
  },
  // Gate 21: the structured human quality-review record, when one exists -
  // included so the review UI can show a prior review without a second
  // request, and so tests can assert on it directly from `get()`.
  qualityReview: {
    include: { reviewer: { select: { id: true, email: true } } },
  },
} satisfies Prisma.AiQuestionCandidateInclude;

export type CandidateWithRelations = Prisma.AiQuestionCandidateGetPayload<{
  include: typeof CANDIDATE_INCLUDE;
}>;

@Injectable()
export class AiCandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCandidatesQueryDto): Promise<PaginatedResult<CandidateWithRelations>> {
    const where: Prisma.AiQuestionCandidateWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.runId ? { runId: query.runId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.aiQuestionCandidate.findMany({
        where,
        include: CANDIDATE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.aiQuestionCandidate.count({ where }),
    ]);
    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<CandidateWithRelations> {
    const candidate = await this.prisma.aiQuestionCandidate.findUnique({
      where: { id },
      include: CANDIDATE_INCLUDE,
    });
    if (!candidate) {
      throw new NotFoundException('AI question candidate not found');
    }
    return candidate;
  }

  async accept(id: string, actorId: string): Promise<CandidateWithRelations> {
    const candidate = await this.get(id);
    if (candidate.status !== 'READY_FOR_REVIEW' && candidate.status !== 'IN_REVIEW') {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.INVALID_CANDIDATE_TRANSITION,
        `Cannot accept a candidate in status ${candidate.status}.`,
      );
    }

    await this.prisma.aiQuestionCandidate.update({
      where: { id },
      data: { status: 'ACCEPTED', reviewerId: actorId, reviewedAt: new Date() },
    });

    await this.audit.record({
      action: AuditAction.AI_CANDIDATE_ACCEPTED,
      entity: 'ai_question_candidate',
      entityId: id,
      actorId,
    });

    return this.get(id);
  }

  async reject(id: string, reason: string, actorId: string): Promise<CandidateWithRelations> {
    const candidate = await this.get(id);
    if (candidate.status === 'ACCEPTED' || candidate.status === 'DISCARDED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.INVALID_CANDIDATE_TRANSITION,
        `Cannot reject a candidate in status ${candidate.status}.`,
      );
    }
    if (candidate.convertedQuestionId) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.CANDIDATE_ALREADY_CONVERTED,
        'This candidate has already been converted into a question and cannot be rejected.',
      );
    }

    await this.prisma.aiQuestionCandidate.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewerId: actorId,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    });

    await this.audit.record({
      action: AuditAction.AI_CANDIDATE_REJECTED,
      entity: 'ai_question_candidate',
      entityId: id,
      actorId,
      metadata: { reason },
    });

    return this.get(id);
  }
}
