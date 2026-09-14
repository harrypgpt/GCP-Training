import { Injectable } from '@nestjs/common';

import { ContentStatus, ProgressStatus } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { ContentAccessService } from '../common/content-access.service';
import {
  TrainingStateComputer,
  type TrainingProgressSummary,
} from '../common/training-state.service';

export interface LessonCompletionResult {
  lessonId: string;
  moduleId: string;
  moduleCompleted: boolean;
  progress: TrainingProgressSummary;
}

/**
 * The one, narrow write path for "this lesson is done". No endpoint anywhere
 * accepts a client-supplied progress percentage or completion flag — every
 * completion is derived here from validated server state, and module/overall
 * completion are always *recomputed*, never toggled directly.
 */
@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly trainingState: TrainingStateComputer,
  ) {}

  async completeLesson(userId: string, lessonId: string): Promise<LessonCompletionResult> {
    // Re-validates: authenticated learner, real enrollment, correct
    // program/level/module/lesson hierarchy, published content, module unlocked.
    const {
      lesson,
      module: courseModule,
      level,
      enrollment,
    } = await this.access.resolveLessonForAccess(userId, lessonId);

    const now = new Date();
    await this.prisma.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id } },
      update: { status: ProgressStatus.COMPLETED, completedAt: now, lastAccessedAt: now },
      create: {
        enrollmentId: enrollment.id,
        lessonId: lesson.id,
        status: ProgressStatus.COMPLETED,
        firstAccessedAt: now,
        lastAccessedAt: now,
        completedAt: now,
      },
    });

    const moduleCompleted = await this.recomputeModule(enrollment.id, courseModule.id, now);
    await this.recomputeEnrollment(enrollment.id, level.id, now);

    const refreshedEnrollment = await this.prisma.enrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    const progress = await this.trainingState.summarize(refreshedEnrollment);

    return { lessonId: lesson.id, moduleId: courseModule.id, moduleCompleted, progress };
  }

  /**
   * A module is COMPLETED only when every one of its currently-published
   * lessons is COMPLETED. This is the single extension point for future,
   * more elaborate per-module completion rules (e.g. a minimum knowledge
   * check) — everything else in the codebase calls this function rather
   * than re-deriving module completion itself.
   */
  private async recomputeModule(
    enrollmentId: string,
    moduleId: string,
    now: Date,
  ): Promise<boolean> {
    const publishedLessons = await this.prisma.lesson.findMany({
      where: { moduleId, reviewStatus: ContentStatus.PUBLISHED },
      select: { id: true },
    });
    const completedCount = publishedLessons.length
      ? await this.prisma.lessonProgress.count({
          where: {
            enrollmentId,
            lessonId: { in: publishedLessons.map((l) => l.id) },
            status: ProgressStatus.COMPLETED,
          },
        })
      : 0;
    const moduleCompleted =
      publishedLessons.length > 0 && completedCount === publishedLessons.length;

    await this.prisma.moduleProgress.upsert({
      where: { enrollmentId_moduleId: { enrollmentId, moduleId } },
      update: {
        status: moduleCompleted ? ProgressStatus.COMPLETED : ProgressStatus.IN_PROGRESS,
        lastAccessedAt: now,
        ...(moduleCompleted ? { completedAt: now } : {}),
      },
      create: {
        enrollmentId,
        moduleId,
        status: moduleCompleted ? ProgressStatus.COMPLETED : ProgressStatus.IN_PROGRESS,
        firstAccessedAt: now,
        lastAccessedAt: now,
        ...(moduleCompleted ? { completedAt: now } : {}),
      },
    });

    return moduleCompleted;
  }

  /**
   * Recomputes the enrollment's overall progress percentage (completed
   * published lessons ÷ total published lessons in the level) and, the
   * first time every published module is complete, stamps `completedAt`.
   * `status` is intentionally left untouched here — COMPLETED is reserved
   * for when the (not-yet-built) examination is passed.
   */
  private async recomputeEnrollment(
    enrollmentId: string,
    levelId: string,
    now: Date,
  ): Promise<void> {
    const levelLessons = await this.prisma.lesson.findMany({
      where: { module: { levelId }, reviewStatus: ContentStatus.PUBLISHED },
      select: { id: true },
    });
    const totalLessons = levelLessons.length;
    const completedTotal = totalLessons
      ? await this.prisma.lessonProgress.count({
          where: {
            enrollmentId,
            lessonId: { in: levelLessons.map((l) => l.id) },
            status: ProgressStatus.COMPLETED,
          },
        })
      : 0;
    const overallProgressPercent =
      totalLessons === 0 ? 0 : Math.round((completedTotal / totalLessons) * 10000) / 100;

    const levelModules = await this.prisma.module.findMany({
      where: { levelId, reviewStatus: ContentStatus.PUBLISHED },
      select: { id: true },
    });
    const completedModules = levelModules.length
      ? await this.prisma.moduleProgress.count({
          where: {
            enrollmentId,
            moduleId: { in: levelModules.map((m) => m.id) },
            status: ProgressStatus.COMPLETED,
          },
        })
      : 0;
    const allModulesComplete = levelModules.length > 0 && completedModules === levelModules.length;

    const existing = await this.prisma.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
    });

    await this.prisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        overallProgressPercent,
        ...(allModulesComplete && !existing.completedAt ? { completedAt: now } : {}),
      },
    });
  }
}
