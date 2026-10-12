import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { LearnerErrorCode } from '@gcp/shared';
import { type ReadingCompletionStatus } from '@prisma/client';

import { findCurrentIchE6R3SourceVersion } from '../../admin/exams/ich-e6r3-authority.util';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';

export interface TableOfContentsEntry {
  sectionIdentifier: string;
  heading: string | null;
  depth: number;
  sequence: number;
}

export interface IchE6R3ProgressView {
  status: ReadingCompletionStatus;
  lastViewedSequence: number;
  totalSections: number;
  progressPercent: number;
  trainingStartedAt: Date | null;
  trainingCompletedAt: Date | null;
}

export interface IchE6R3OverviewView {
  sourceVersionId: string;
  documentTitle: string;
  documentVersion: string | null;
  adoptionDate: Date | null;
  license: string | null;
  attributionRequired: boolean;
  tableOfContents: TableOfContentsEntry[];
  progress: IchE6R3ProgressView;
}

export interface IchE6R3SectionView {
  sectionIdentifier: string;
  heading: string | null;
  depth: number;
  sequence: number;
  /** The section's exact registered text - never a download, never a raw
   * file URL. Rendered inline by the learner-facing reader only. */
  content: string;
  isFirst: boolean;
  isLast: boolean;
  progress: IchE6R3ProgressView;
}

/**
 * Gate 29: the learner-facing ICH E6(R3) document reader's data layer.
 * Reuses the existing Source/SourceVersion/SourceSection architecture
 * (never a second document repository) and the new, additive
 * `SourceReadingProgress` model - the ONLY place that ever writes it.
 *
 * Deliberately never returns a downloadable file, a raw storage URL, or a
 * signed download link anywhere - every method returns rendered section
 * text for in-application display only (Gate 29 §5).
 */
@Injectable()
export class IchE6R3ReadingService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(userId: string): Promise<IchE6R3OverviewView> {
    const { sourceVersionId, source } = await this.loadCurrentVersion();

    const sections = await this.prisma.sourceSection.findMany({
      where: { sourceVersionId },
      orderBy: { sequence: 'asc' },
      select: { sectionIdentifier: true, heading: true, depth: true, sequence: true },
    });

    const progressRow = await this.findOrCreateProgress(userId, sourceVersionId);
    const version = await this.prisma.sourceVersion.findUniqueOrThrow({
      where: { id: sourceVersionId },
      select: {
        documentVersion: true,
        effectiveDate: true,
        license: true,
        attributionRequired: true,
      },
    });

    return {
      sourceVersionId,
      documentTitle: source.title,
      documentVersion: version.documentVersion,
      adoptionDate: version.effectiveDate,
      license: version.license,
      attributionRequired: version.attributionRequired,
      tableOfContents: sections,
      progress: this.toProgressView(progressRow, sections.length),
    };
  }

  async getSection(userId: string, sequence: number): Promise<IchE6R3SectionView> {
    const { sourceVersionId } = await this.loadCurrentVersion();

    const sections = await this.prisma.sourceSection.findMany({
      where: { sourceVersionId },
      orderBy: { sequence: 'asc' },
      select: {
        sectionIdentifier: true,
        heading: true,
        depth: true,
        sequence: true,
        content: true,
      },
    });
    if (sections.length === 0) {
      throw new NotFoundException('No training material is currently registered.');
    }
    const target = sections.find((s) => s.sequence === sequence);
    if (!target) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        LearnerErrorCode.CONTENT_NOT_AVAILABLE,
        'This page of the training material does not exist.',
      );
    }
    const maxSequence = sections[sections.length - 1]!.sequence;

    const progressRow = await this.recordView(userId, sourceVersionId, sequence, maxSequence);

    return {
      sectionIdentifier: target.sectionIdentifier,
      heading: target.heading,
      depth: target.depth,
      sequence: target.sequence,
      content: target.content,
      isFirst: sequence === sections[0]!.sequence,
      isLast: sequence === maxSequence,
      progress: this.toProgressView(progressRow, sections.length),
    };
  }

  /** The sole authority `LearnerExamAttemptService` consults for "has this
   * learner completed the required ICH E6(R3) reading". Server-side only -
   * never trusted from the client. */
  async isTrainingComplete(userId: string): Promise<boolean> {
    const { sourceVersionId } = await this.loadCurrentVersion();
    const progress = await this.prisma.sourceReadingProgress.findUnique({
      where: { userId_sourceVersionId: { userId, sourceVersionId } },
    });
    return progress?.status === 'COMPLETED';
  }

  /**
   * Gate 29 §20: the sole entry point into the RETRAINING_REQUIRED state -
   * called only by `LearnerExamScoringService` when an attempt against the
   * ICH E6(R3) certification exam finalizes as FAILED. Never invoked by any
   * learner-facing endpoint directly.
   */
  async requireRetraining(userId: string): Promise<void> {
    const { sourceVersionId } = await this.loadCurrentVersion();
    await this.prisma.sourceReadingProgress.updateMany({
      where: { userId, sourceVersionId, status: 'COMPLETED' },
      data: { status: 'RETRAINING_REQUIRED' },
    });
  }

  private async loadCurrentVersion(): Promise<{
    sourceVersionId: string;
    source: { title: string };
  }> {
    const version = await findCurrentIchE6R3SourceVersion(this.prisma);
    const source = await this.prisma.source.findUniqueOrThrow({
      where: { id: version.sourceId },
      select: { title: true },
    });
    return { sourceVersionId: version.id, source };
  }

  private async findOrCreateProgress(
    userId: string,
    sourceVersionId: string,
  ): Promise<{
    status: ReadingCompletionStatus;
    lastViewedSequence: number;
    trainingStartedAt: Date | null;
    trainingCompletedAt: Date | null;
  }> {
    const existing = await this.prisma.sourceReadingProgress.findUnique({
      where: { userId_sourceVersionId: { userId, sourceVersionId } },
    });
    if (existing) return existing;
    return this.prisma.sourceReadingProgress.create({ data: { userId, sourceVersionId } });
  }

  /**
   * The ONLY place `SourceReadingProgress` is written from a learner action.
   * Deterministic: completion means reaching the furthest (last) section in
   * document order at least once - never a self-reported percentage, never
   * a time-spent-reading heuristic (Gate 29 §7: "Do not require arbitrary
   * time spent reading").
   */
  private async recordView(
    userId: string,
    sourceVersionId: string,
    sequence: number,
    maxSequence: number,
  ): Promise<{
    status: ReadingCompletionStatus;
    lastViewedSequence: number;
    trainingStartedAt: Date | null;
    trainingCompletedAt: Date | null;
  }> {
    const existing = await this.findOrCreateProgress(userId, sourceVersionId);
    const now = new Date();
    const reachedEnd = sequence >= maxSequence;

    const data: {
      lastViewedSequence?: number;
      status?: ReadingCompletionStatus;
      trainingStartedAt?: Date;
      trainingCompletedAt?: Date;
    } = {};

    if (!existing.trainingStartedAt) {
      data.trainingStartedAt = now;
    }
    if (sequence > existing.lastViewedSequence) {
      data.lastViewedSequence = sequence;
    }
    if (reachedEnd) {
      data.status = 'COMPLETED';
      if (!existing.trainingCompletedAt) {
        data.trainingCompletedAt = now;
      }
    } else if (existing.status === 'NOT_STARTED') {
      data.status = 'IN_PROGRESS';
    }
    // A learner already RETRAINING_REQUIRED stays that way until they reach
    // the end again (handled by the `reachedEnd` branch above overriding it
    // back to COMPLETED) - viewing an earlier page never clears it early.

    if (Object.keys(data).length === 0) {
      return existing;
    }
    return this.prisma.sourceReadingProgress.update({
      where: { userId_sourceVersionId: { userId, sourceVersionId } },
      data,
    });
  }

  private toProgressView(
    row: {
      status: ReadingCompletionStatus;
      lastViewedSequence: number;
      trainingStartedAt: Date | null;
      trainingCompletedAt: Date | null;
    },
    totalSections: number,
  ): IchE6R3ProgressView {
    const progressPercent =
      totalSections > 0 ? Math.round(((row.lastViewedSequence + 1) / totalSections) * 100) : 0;
    return {
      status: row.status,
      lastViewedSequence: row.lastViewedSequence,
      totalSections,
      progressPercent: Math.min(100, progressPercent),
      trainingStartedAt: row.trainingStartedAt,
      trainingCompletedAt: row.trainingCompletedAt,
    };
  }
}
