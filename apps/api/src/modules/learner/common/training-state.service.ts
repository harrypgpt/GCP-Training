import { Injectable } from '@nestjs/common';

import { TrainingState, type TrainingState as TrainingStateType } from '@gcp/shared';
import { ContentStatus, type Enrollment, ProgressStatus } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

export interface TrainingProgressSummary {
  overallProgressPercent: number;
  completedModules: number;
  totalModules: number;
  /**
   * `TRAINING_COMPLETED` is reserved for a future stage (exam passed) and is
   * never returned here — Stage 5 only ever reports IN_PROGRESS or
   * EXAM_ELIGIBLE, both derived solely from published-content progress.
   */
  trainingState: TrainingStateType;
  examEligible: boolean;
}

/**
 * The one place "is this learner exam-eligible?" is computed. Always derived
 * from `ModuleProgress` rows against currently-published modules — never
 * trusted from the client, never inferred from frontend state.
 */
@Injectable()
export class TrainingStateComputer {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(enrollment: Enrollment): Promise<TrainingProgressSummary> {
    const totalModules = await this.prisma.module.count({
      where: { levelId: enrollment.levelId, reviewStatus: ContentStatus.PUBLISHED },
    });
    const completedModules = await this.prisma.moduleProgress.count({
      where: {
        enrollmentId: enrollment.id,
        status: ProgressStatus.COMPLETED,
        module: { reviewStatus: ContentStatus.PUBLISHED },
      },
    });
    const examEligible = totalModules > 0 && completedModules === totalModules;

    return {
      overallProgressPercent: Number(enrollment.overallProgressPercent),
      completedModules,
      totalModules,
      trainingState: examEligible
        ? TrainingState.EXAM_ELIGIBLE
        : TrainingState.TRAINING_IN_PROGRESS,
      examEligible,
    };
  }
}
