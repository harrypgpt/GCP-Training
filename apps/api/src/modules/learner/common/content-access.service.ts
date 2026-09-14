import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { LearnerErrorCode } from '@gcp/shared';
import {
  ContentStatus,
  type Enrollment,
  EnrollmentStatus,
  type Lesson,
  type Module as CourseModule,
  ProgressStatus,
  type TrainingLevel,
  type TrainingProgram,
} from '@prisma/client';

import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';

export type ModuleStateValue = 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED';

export interface ResolvedLesson {
  lesson: Lesson;
  module: CourseModule;
  level: TrainingLevel;
  program: TrainingProgram;
  enrollment: Enrollment;
  moduleState: ModuleStateValue;
}

/**
 * The single place that decides what a learner is allowed to see and do.
 * Every learner-facing read/write that touches program→level→module→lesson
 * content goes through here, so "published only" and "module unlock" are
 * enforced exactly once, not re-implemented per endpoint.
 */
@Injectable()
export class ContentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The learner's most recent non-cancelled enrollment in a level, or null. */
  async findEnrollment(userId: string, levelId: string): Promise<Enrollment | null> {
    return this.prisma.enrollment.findFirst({
      where: {
        userId,
        levelId,
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
      },
      orderBy: { cycleNumber: 'desc' },
    });
  }

  async requireEnrollment(userId: string, levelId: string): Promise<Enrollment> {
    const enrollment = await this.findEnrollment(userId, levelId);
    if (!enrollment) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        LearnerErrorCode.NOT_ENROLLED,
        'You are not enrolled in this training level.',
      );
    }
    return enrollment;
  }

  async getPublishedModules(levelId: string): Promise<CourseModule[]> {
    return this.prisma.module.findMany({
      where: { levelId, reviewStatus: ContentStatus.PUBLISHED },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getPublishedLessons(moduleId: string): Promise<Lesson[]> {
    return this.prisma.lesson.findMany({
      where: { moduleId, reviewStatus: ContentStatus.PUBLISHED },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Sequential-unlock module states for one enrollment: the first published
   * module is always reachable; each subsequent module unlocks only once the
   * previous one is COMPLETED. Purely server-derived — the client never
   * supplies or overrides this.
   */
  async getModuleStates(
    enrollmentId: string,
    levelId: string,
  ): Promise<Map<string, ModuleStateValue>> {
    const modules = await this.getPublishedModules(levelId);
    const progressRows = await this.prisma.moduleProgress.findMany({
      where: { enrollmentId, moduleId: { in: modules.map((m) => m.id) } },
    });
    const progressByModule = new Map(progressRows.map((p) => [p.moduleId, p]));

    const states = new Map<string, ModuleStateValue>();
    let unlocked = true;
    for (const courseModule of modules) {
      if (!unlocked) {
        states.set(courseModule.id, 'LOCKED');
        continue;
      }
      const status = progressByModule.get(courseModule.id)?.status ?? ProgressStatus.NOT_STARTED;
      states.set(courseModule.id, status === ProgressStatus.NOT_STARTED ? 'AVAILABLE' : status);
      unlocked = status === ProgressStatus.COMPLETED;
    }
    return states;
  }

  /**
   * Resolves a lesson id to its full, published hierarchy and confirms the
   * caller is enrolled and the containing module is unlocked. Throws 404 for
   * anything not fully published (never reveals draft/archived content even
   * exists) and 403 for enrollment/lock failures.
   */
  async resolveLessonForAccess(userId: string, lessonId: string): Promise<ResolvedLesson> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { level: { include: { program: true } } } } },
    });

    if (!lesson || lesson.reviewStatus !== ContentStatus.PUBLISHED) {
      throw new NotFoundException('Lesson not found');
    }
    const { module } = lesson;
    if (module.reviewStatus !== ContentStatus.PUBLISHED) {
      throw new NotFoundException('Lesson not found');
    }
    const { level } = module;
    if (level.reviewStatus !== ContentStatus.PUBLISHED) {
      throw new NotFoundException('Lesson not found');
    }
    if (level.program.reviewStatus !== ContentStatus.PUBLISHED) {
      throw new NotFoundException('Lesson not found');
    }

    const enrollment = await this.requireEnrollment(userId, level.id);
    const moduleStates = await this.getModuleStates(enrollment.id, level.id);
    const moduleState = moduleStates.get(module.id);

    if (!moduleState || moduleState === 'LOCKED') {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        LearnerErrorCode.MODULE_LOCKED,
        'This module is locked until earlier modules are completed.',
      );
    }

    return { lesson, module, level, program: level.program, enrollment, moduleState };
  }
}
