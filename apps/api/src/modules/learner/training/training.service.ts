import { Injectable, NotFoundException } from '@nestjs/common';

import { ContentStatus, ProgressStatus } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { ContentAccessService, type ModuleStateValue } from '../common/content-access.service';

export interface LevelModuleNavView {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  state: ModuleStateValue;
  lessonCount: number;
  completedLessonCount: number;
}

export interface LevelDetailView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  program: { id: string; slug: string; title: string };
  modules: LevelModuleNavView[];
}

export interface ModuleLessonNavView {
  id: string;
  title: string;
  sortOrder: number;
  state: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface ObjectiveView {
  id: string;
  description: string;
}

export interface ModuleDetailView {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
  state: ModuleStateValue;
  objectives: ObjectiveView[];
  lessons: ModuleLessonNavView[];
}

export interface ReferenceView {
  id: string;
  title: string;
  citation: string | null;
  url: string | null;
}

export interface LessonCaseStudyView {
  id: string;
  caseCode: string;
  title: string;
  scenario: string;
  context: string | null;
  observation: string;
  domain: { id: string; name: string } | null;
  riskCategory: string | null;
  expectedAction: string | null;
}

export interface LessonDetailView {
  id: string;
  title: string;
  content: string | null;
  sortOrder: number;
  moduleId: string;
  moduleState: ModuleStateValue;
  completionState: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  objectives: ObjectiveView[];
  references: ReferenceView[];
  caseStudies: LessonCaseStudyView[];
  previousLessonId: string | null;
  nextLessonId: string | null;
}

/**
 * Read-only, published-only navigation of program → level → module → lesson.
 * Every method requires the caller to already be enrolled in the level being
 * browsed (see {@link ContentAccessService}) — there is no "preview" mode.
 */
@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
  ) {}

  async getLevel(userId: string, levelId: string): Promise<LevelDetailView> {
    const level = await this.prisma.trainingLevel.findUnique({
      where: { id: levelId },
      include: { program: true },
    });
    if (
      !level ||
      level.reviewStatus !== ContentStatus.PUBLISHED ||
      level.program.reviewStatus !== ContentStatus.PUBLISHED
    ) {
      throw new NotFoundException('Training level not found');
    }

    const enrollment = await this.access.requireEnrollment(userId, levelId);
    const modules = await this.access.getPublishedModules(levelId);
    const moduleStates = await this.access.getModuleStates(enrollment.id, levelId);

    const lessonCounts = await this.prisma.lesson.groupBy({
      by: ['moduleId'],
      where: { moduleId: { in: modules.map((m) => m.id) }, reviewStatus: ContentStatus.PUBLISHED },
      _count: { _all: true },
    });
    const lessonCountByModule = new Map(lessonCounts.map((row) => [row.moduleId, row._count._all]));

    const completedCounts = await this.prisma.lessonProgress.groupBy({
      by: ['lessonId'],
      where: {
        enrollmentId: enrollment.id,
        status: ProgressStatus.COMPLETED,
        lesson: { moduleId: { in: modules.map((m) => m.id) } },
      },
    });
    const completedLessonIds = new Set(completedCounts.map((row) => row.lessonId));
    const completedLessons = await this.prisma.lesson.findMany({
      where: { id: { in: [...completedLessonIds] } },
      select: { id: true, moduleId: true },
    });
    const completedCountByModule = new Map<string, number>();
    for (const lesson of completedLessons) {
      completedCountByModule.set(
        lesson.moduleId,
        (completedCountByModule.get(lesson.moduleId) ?? 0) + 1,
      );
    }

    return {
      id: level.id,
      code: level.code,
      name: level.name,
      description: level.description,
      program: { id: level.program.id, slug: level.program.slug, title: level.program.title },
      modules: modules.map((courseModule) => ({
        id: courseModule.id,
        title: courseModule.title,
        description: courseModule.description,
        sortOrder: courseModule.sortOrder,
        state: moduleStates.get(courseModule.id) ?? 'LOCKED',
        lessonCount: lessonCountByModule.get(courseModule.id) ?? 0,
        completedLessonCount: completedCountByModule.get(courseModule.id) ?? 0,
      })),
    };
  }

  async getModule(userId: string, moduleId: string): Promise<ModuleDetailView> {
    const courseModule = await this.prisma.module.findUnique({
      where: { id: moduleId },
      include: { level: { include: { program: true } } },
    });
    if (
      !courseModule ||
      courseModule.reviewStatus !== ContentStatus.PUBLISHED ||
      courseModule.level.reviewStatus !== ContentStatus.PUBLISHED ||
      courseModule.level.program.reviewStatus !== ContentStatus.PUBLISHED
    ) {
      throw new NotFoundException('Module not found');
    }

    const enrollment = await this.access.requireEnrollment(userId, courseModule.levelId);
    const moduleStates = await this.access.getModuleStates(enrollment.id, courseModule.levelId);
    const state = moduleStates.get(moduleId) ?? 'LOCKED';

    const lessons = await this.access.getPublishedLessons(moduleId);
    const progressRows = await this.prisma.lessonProgress.findMany({
      where: { enrollmentId: enrollment.id, lessonId: { in: lessons.map((l) => l.id) } },
    });
    const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p.status]));

    const objectives = await this.prisma.learningObjective.findMany({
      where: { lessonId: { in: lessons.map((l) => l.id) } },
      orderBy: { sortOrder: 'asc' },
    });

    return {
      id: courseModule.id,
      title: courseModule.title,
      description: courseModule.description,
      sortOrder: courseModule.sortOrder,
      state,
      objectives: objectives.map((o) => ({ id: o.id, description: o.description })),
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        sortOrder: lesson.sortOrder,
        state: progressByLesson.get(lesson.id) ?? ProgressStatus.NOT_STARTED,
      })),
    };
  }

  async getLesson(userId: string, lessonId: string): Promise<LessonDetailView> {
    const {
      lesson,
      module: courseModule,
      enrollment,
      moduleState,
    } = await this.access.resolveLessonForAccess(userId, lessonId);

    await this.recordLessonAccess(enrollment.id, lesson.id, courseModule.id);

    const [objectives, siblingLessons, progress] = await Promise.all([
      this.prisma.learningObjective.findMany({
        where: { lessonId: lesson.id },
        orderBy: { sortOrder: 'asc' },
      }),
      this.access.getPublishedLessons(courseModule.id),
      this.prisma.lessonProgress.findUnique({
        where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id } },
      }),
    ]);

    const objectiveIds = objectives.map((o) => o.id);
    const caseStudies = objectiveIds.length
      ? await this.prisma.caseStudy.findMany({
          where: {
            learningObjectiveId: { in: objectiveIds },
            reviewStatus: ContentStatus.PUBLISHED,
            isActive: true,
          },
          include: { domain: true },
        })
      : [];

    const sourceIds = [
      ...new Set(caseStudies.map((c) => c.sourceId).filter((id): id is string => !!id)),
    ];
    const sources = sourceIds.length
      ? await this.prisma.source.findMany({ where: { id: { in: sourceIds } } })
      : [];

    const index = siblingLessons.findIndex((l) => l.id === lesson.id);
    const previousLessonId = index > 0 ? (siblingLessons[index - 1]?.id ?? null) : null;
    const nextLessonId =
      index >= 0 && index < siblingLessons.length - 1
        ? (siblingLessons[index + 1]?.id ?? null)
        : null;

    return {
      id: lesson.id,
      title: lesson.title,
      content: lesson.content,
      sortOrder: lesson.sortOrder,
      moduleId: courseModule.id,
      moduleState,
      completionState: progress?.status ?? ProgressStatus.NOT_STARTED,
      objectives: objectives.map((o) => ({ id: o.id, description: o.description })),
      references: sources.map((s) => ({
        id: s.id,
        title: s.title,
        citation: s.citation,
        url: s.url,
      })),
      caseStudies: caseStudies.map((c) => ({
        id: c.id,
        caseCode: c.caseCode,
        title: c.title,
        scenario: c.scenario,
        context: c.context,
        observation: c.observation,
        domain: c.domain ? { id: c.domain.id, name: c.domain.name } : null,
        riskCategory: c.riskCategory,
        expectedAction: c.expectedAction,
      })),
      previousLessonId,
      nextLessonId,
    };
  }

  /** Marks a lesson (and its module, and the enrollment) as at least IN_PROGRESS. */
  private async recordLessonAccess(
    enrollmentId: string,
    lessonId: string,
    moduleId: string,
  ): Promise<void> {
    const now = new Date();

    const [existingLesson, existingModule] = await Promise.all([
      this.prisma.lessonProgress.findUnique({
        where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
      }),
      this.prisma.moduleProgress.findUnique({
        where: { enrollmentId_moduleId: { enrollmentId, moduleId } },
      }),
    ]);

    const lessonStatus =
      existingLesson?.status === ProgressStatus.COMPLETED
        ? ProgressStatus.COMPLETED
        : ProgressStatus.IN_PROGRESS;
    const moduleStatus =
      existingModule?.status === ProgressStatus.COMPLETED
        ? ProgressStatus.COMPLETED
        : ProgressStatus.IN_PROGRESS;

    await Promise.all([
      this.prisma.lessonProgress.upsert({
        where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
        update: { status: lessonStatus, lastAccessedAt: now },
        create: {
          enrollmentId,
          lessonId,
          status: lessonStatus,
          firstAccessedAt: now,
          lastAccessedAt: now,
        },
      }),
      this.prisma.moduleProgress.upsert({
        where: { enrollmentId_moduleId: { enrollmentId, moduleId } },
        update: { status: moduleStatus, lastAccessedAt: now },
        create: {
          enrollmentId,
          moduleId,
          status: moduleStatus,
          firstAccessedAt: now,
          lastAccessedAt: now,
        },
      }),
      this.prisma.enrollment.updateMany({
        where: { id: enrollmentId, startedAt: null },
        data: { startedAt: now },
      }),
      this.prisma.enrollment.update({
        where: { id: enrollmentId },
        data: { lastActivityAt: now, currentModuleId: moduleId, currentLessonId: lessonId },
      }),
    ]);
  }
}
