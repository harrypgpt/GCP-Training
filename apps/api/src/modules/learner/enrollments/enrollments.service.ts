import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { LearnerErrorCode } from '@gcp/shared';
import { ContentStatus, type Enrollment, EnrollmentStatus, Prisma } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  TrainingStateComputer,
  type TrainingProgressSummary,
} from '../common/training-state.service';
import { type CreateEnrollmentDto } from './dto/create-enrollment.dto';

export interface EnrollmentView {
  id: string;
  status: EnrollmentStatus;
  cycleNumber: number;
  program: { id: string; slug: string; title: string };
  level: { id: string; code: string; name: string };
  enrolledAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  lastActivityAt: Date;
  currentModuleId: string | null;
  currentLessonId: string | null;
  progress: TrainingProgressSummary;
}

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingState: TrainingStateComputer,
  ) {}

  async create(userId: string, dto: CreateEnrollmentDto): Promise<EnrollmentView> {
    const level = await this.prisma.trainingLevel.findUnique({
      where: { id: dto.levelId },
      include: { program: true },
    });

    if (
      !level ||
      level.programId !== dto.programId ||
      level.reviewStatus !== ContentStatus.PUBLISHED ||
      level.program.reviewStatus !== ContentStatus.PUBLISHED
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        LearnerErrorCode.LEVEL_NOT_AVAILABLE,
        'This training level is not currently available for enrollment.',
      );
    }

    const existingActive = await this.prisma.enrollment.findFirst({
      where: {
        userId,
        programId: dto.programId,
        levelId: dto.levelId,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    if (existingActive) {
      throw new AppException(
        HttpStatus.CONFLICT,
        LearnerErrorCode.DUPLICATE_ENROLLMENT,
        'You already have an active enrollment in this training level.',
      );
    }

    const lastCycle = await this.prisma.enrollment.findFirst({
      where: { userId, programId: dto.programId, levelId: dto.levelId },
      orderBy: { cycleNumber: 'desc' },
      select: { cycleNumber: true },
    });

    let enrollment;
    try {
      enrollment = await this.prisma.enrollment.create({
        data: {
          userId,
          programId: dto.programId,
          levelId: dto.levelId,
          cycleNumber: (lastCycle?.cycleNumber ?? 0) + 1,
        },
      });
    } catch (error) {
      // Race-condition backstop: the DB partial unique index is the actual
      // source of truth for "no duplicate active enrollment".
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          HttpStatus.CONFLICT,
          LearnerErrorCode.DUPLICATE_ENROLLMENT,
          'You already have an active enrollment in this training level.',
        );
      }
      throw error;
    }

    return this.toView(enrollment.id, userId);
  }

  async listOwn(userId: string): Promise<EnrollmentView[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId },
      orderBy: { enrolledAt: 'desc' },
    });
    return Promise.all(enrollments.map((e) => this.toViewFromEntity(e)));
  }

  async getOwn(userId: string, id: string): Promise<EnrollmentView> {
    return this.toView(id, userId);
  }

  private async toView(id: string, userId: string): Promise<EnrollmentView> {
    const enrollment = await this.prisma.enrollment.findFirst({ where: { id, userId } });
    if (!enrollment) {
      // Never distinguish "not yours" from "doesn't exist".
      throw new NotFoundException('Enrollment not found');
    }
    return this.toViewFromEntity(enrollment);
  }

  private async toViewFromEntity(enrollment: Enrollment): Promise<EnrollmentView> {
    const [program, level, progress] = await Promise.all([
      this.prisma.trainingProgram.findUniqueOrThrow({ where: { id: enrollment.programId } }),
      this.prisma.trainingLevel.findUniqueOrThrow({ where: { id: enrollment.levelId } }),
      this.trainingState.summarize(enrollment),
    ]);

    return {
      id: enrollment.id,
      status: enrollment.status,
      cycleNumber: enrollment.cycleNumber,
      program: { id: program.id, slug: program.slug, title: program.title },
      level: { id: level.id, code: level.code, name: level.name },
      enrolledAt: enrollment.enrolledAt,
      startedAt: enrollment.startedAt,
      completedAt: enrollment.completedAt,
      lastActivityAt: enrollment.lastActivityAt,
      currentModuleId: enrollment.currentModuleId,
      currentLessonId: enrollment.currentLessonId,
      progress,
    };
  }
}
