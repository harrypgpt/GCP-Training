import { Injectable } from '@nestjs/common';

import { EnrollmentStatus } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  TrainingStateComputer,
  type TrainingProgressSummary,
} from '../common/training-state.service';
import { EnrollmentsService, type EnrollmentView } from '../enrollments/enrollments.service';
import { isProfileComplete } from '../common/profile-completion';

export interface DashboardActiveTraining {
  enrollmentId: string;
  program: { id: string; title: string };
  level: { id: string; name: string };
  currentModule: { id: string; title: string } | null;
  currentLesson: { id: string; title: string } | null;
  lastActivityAt: Date;
  progress: TrainingProgressSummary;
}

export interface DashboardView {
  learnerName: string | null;
  profileComplete: boolean;
  activeTraining: DashboardActiveTraining | null;
  enrollments: EnrollmentView[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollmentsService: EnrollmentsService,
    private readonly trainingState: TrainingStateComputer,
  ) {}

  async getOwn(userId: string): Promise<DashboardView> {
    const [profile, enrollments] = await Promise.all([
      this.prisma.learnerProfile.findUnique({ where: { userId } }),
      this.enrollmentsService.listOwn(userId),
    ]);

    const activeEntity = await this.prisma.enrollment.findFirst({
      where: { userId, status: EnrollmentStatus.ACTIVE },
      orderBy: { lastActivityAt: 'desc' },
      include: { program: true, level: true, currentModule: true, currentLesson: true },
    });

    const activeTraining = activeEntity
      ? ({
          enrollmentId: activeEntity.id,
          program: { id: activeEntity.program.id, title: activeEntity.program.title },
          level: { id: activeEntity.level.id, name: activeEntity.level.name },
          currentModule: activeEntity.currentModule
            ? { id: activeEntity.currentModule.id, title: activeEntity.currentModule.title }
            : null,
          currentLesson: activeEntity.currentLesson
            ? { id: activeEntity.currentLesson.id, title: activeEntity.currentLesson.title }
            : null,
          lastActivityAt: activeEntity.lastActivityAt,
          progress: await this.trainingState.summarize(activeEntity),
        } satisfies DashboardActiveTraining)
      : null;

    return {
      learnerName:
        profile?.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : null,
      profileComplete: profile ? isProfileComplete(profile) : false,
      activeTraining,
      enrollments,
    };
  }
}
