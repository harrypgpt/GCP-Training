import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditAction, ObservationErrorCode, type WorkflowAction } from '@gcp/shared';
import { ContentStatus } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { nextReviewStatus, WORKFLOW_ACTION_ROLES } from '../common/workflow';
import { type CreateTrainingInterpretationDto } from './dto/create-training-interpretation.dto';
import { type UpdateTrainingInterpretationDto } from './dto/update-training-interpretation.dto';

export { WORKFLOW_ACTION_ROLES };

export interface TrainingInterpretationResult {
  id: string;
  observationVersionId: string;
  interpretationType: string;
  text: string;
  rationale: string | null;
  reviewStatus: string;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function interpretationNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ObservationErrorCode.TRAINING_INTERPRETATION_NOT_FOUND,
    'Training interpretation not found.',
  );
}

function versionNotFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ObservationErrorCode.OBSERVATION_VERSION_NOT_FOUND,
    'Observation version not found.',
  );
}

/**
 * Gate 13 §19/§20: a controlled, curated interpretation of an
 * observation's practical training meaning - structurally and visually
 * distinct from the observation's own evidence, FDA wording, or any
 * authoritative source wording. Reuses the platform's existing generic
 * DRAFT/REVIEW/APPROVED workflow rather than inventing a parallel one;
 * never auto-published (PUBLISH/ARCHIVE/RESTORE are simply never surfaced
 * for this resource in the admin UI, though the underlying FSM permits
 * them like any other ContentStatus-governed entity).
 */
@Injectable()
export class ObservationTrainingInterpretationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    versionId: string,
    dto: CreateTrainingInterpretationDto,
    actorId: string,
  ): Promise<TrainingInterpretationResult> {
    const version = await this.prisma.observationVersion.findUnique({ where: { id: versionId } });
    if (!version) throw versionNotFound();
    this.assertEditable(version.reviewStatus);

    const created = await this.prisma.observationTrainingInterpretation.create({
      data: {
        observationVersionId: versionId,
        interpretationType: dto.interpretationType,
        text: dto.text,
        ...(dto.rationale ? { rationale: dto.rationale } : {}),
        createdById: actorId,
      },
    });

    await this.audit.record({
      action: AuditAction.OBSERVATION_TRAINING_INTERPRETATION_CREATED,
      entity: 'observation_training_interpretation',
      entityId: created.id,
      actorId,
      metadata: { observationVersionId: versionId, interpretationType: dto.interpretationType },
    });

    return created;
  }

  async listForVersion(versionId: string): Promise<TrainingInterpretationResult[]> {
    const exists = await this.prisma.observationVersion.findUnique({ where: { id: versionId } });
    if (!exists) throw versionNotFound();
    return this.prisma.observationTrainingInterpretation.findMany({
      where: { observationVersionId: versionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(
    versionId: string,
    interpretationId: string,
    dto: UpdateTrainingInterpretationDto,
    actorId: string,
  ): Promise<TrainingInterpretationResult> {
    const [version, interpretation] = await Promise.all([
      this.prisma.observationVersion.findUnique({ where: { id: versionId } }),
      this.prisma.observationTrainingInterpretation.findUnique({ where: { id: interpretationId } }),
    ]);
    if (!version) throw versionNotFound();
    if (!interpretation || interpretation.observationVersionId !== versionId) {
      throw interpretationNotFound();
    }
    this.assertEditable(version.reviewStatus);
    this.assertInterpretationEditable(interpretation.reviewStatus);

    const updated = await this.prisma.observationTrainingInterpretation.update({
      where: { id: interpretationId },
      data: {
        ...(dto.interpretationType ? { interpretationType: dto.interpretationType } : {}),
        ...(dto.text ? { text: dto.text } : {}),
        ...(dto.rationale !== undefined ? { rationale: dto.rationale } : {}),
      },
    });

    await this.audit.record({
      action: AuditAction.OBSERVATION_TRAINING_INTERPRETATION_UPDATED,
      entity: 'observation_training_interpretation',
      entityId: interpretationId,
      actorId,
      metadata: { observationVersionId: versionId },
    });

    return updated;
  }

  async transition(
    versionId: string,
    interpretationId: string,
    action: WorkflowAction,
    actorId: string,
  ): Promise<TrainingInterpretationResult> {
    const [version, interpretation] = await Promise.all([
      this.prisma.observationVersion.findUnique({ where: { id: versionId } }),
      this.prisma.observationTrainingInterpretation.findUnique({ where: { id: interpretationId } }),
    ]);
    if (!version) throw versionNotFound();
    if (!interpretation || interpretation.observationVersionId !== versionId) {
      throw interpretationNotFound();
    }
    this.assertEditable(version.reviewStatus);

    const nextStatus = nextReviewStatus(interpretation.reviewStatus, action);
    const updated = await this.prisma.observationTrainingInterpretation.update({
      where: { id: interpretationId },
      data: {
        reviewStatus: nextStatus,
        ...(action === 'APPROVE' ? { approvedAt: new Date() } : {}),
      },
    });

    await this.audit.record({
      action: AuditAction.OBSERVATION_TRAINING_INTERPRETATION_STATUS_CHANGED,
      entity: 'observation_training_interpretation',
      entityId: interpretationId,
      actorId,
      metadata: { action, from: interpretation.reviewStatus, to: nextStatus },
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

  private assertInterpretationEditable(reviewStatus: ContentStatus): void {
    if (reviewStatus === ContentStatus.APPROVED || reviewStatus === ContentStatus.ARCHIVED) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ObservationErrorCode.CURATION_NOT_EDITABLE,
        'An approved or archived training interpretation cannot be edited directly - reopen it first.',
      );
    }
  }
}
