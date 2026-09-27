import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ContentErrorCode, ExamErrorCode, type ExamVersionAction } from '@gcp/shared';
import { ExamVersionStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginatedResult,
  paginationSkipTake,
  type PaginatedResult,
} from '../common/pagination';
import { loadLatestExamVersion } from './exam-common';
import { ExamBlueprintValidationService } from './exam-blueprint-validation.service';
import { nextExamVersionStatus } from './exam-version-workflow';
import { type CreateExamDto } from './dto/create-exam.dto';
import { type ListExamsQueryDto } from './dto/list-exams.query.dto';
import { type UpdateExamDto } from './dto/update-exam.dto';

export interface ExamVersionSummary {
  id: string;
  versionNumber: number;
  status: ExamVersionStatus;
  isActiveVersion: boolean;
  levelId: string;
  level: { id: string; name: string } | null;
  questionCount: number;
  marksPerQuestion: number;
  totalMarks: number;
  passPercentage: number;
  durationMinutes: number | null;
  maxAttempts: number;
  hasBlueprint: boolean;
  createdBy: { id: string; email: string } | null;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  trainingProgramId: string;
  program: { id: string; title: string } | null;
  activeVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  latestVersion: ExamVersionSummary;
  versions: ExamVersionSummary[];
}

export interface ExamListItem {
  id: string;
  code: string;
  name: string;
  trainingProgramId: string;
  activeVersionId: string | null;
  updatedAt: Date;
  latestVersion: {
    id: string;
    versionNumber: number;
    status: ExamVersionStatus;
    questionCount: number;
    totalMarks: number;
    passPercentage: number;
    levelId: string;
  };
}

const VERSION_SELECT = {
  id: true,
  versionNumber: true,
  status: true,
  levelId: true,
  level: { select: { id: true, name: true } },
  questionCount: true,
  marksPerQuestion: true,
  totalMarks: true,
  passPercentage: true,
  durationMinutes: true,
  maxAttempts: true,
  createdBy: { select: { id: true, email: true } },
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
  blueprint: { select: { id: true } },
} satisfies Prisma.ExamVersionSelect;

type VersionRow = Prisma.ExamVersionGetPayload<{ select: typeof VERSION_SELECT }>;

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly blueprintValidation: ExamBlueprintValidationService,
  ) {}

  async list(query: ListExamsQueryDto): Promise<PaginatedResult<ExamListItem>> {
    const where: Prisma.ExamWhereInput = {
      ...(query.trainingProgramId ? { trainingProgramId: query.trainingProgramId } : {}),
      ...(query.status ? { versions: { some: { status: query.status } } } : {}),
    };

    const [exams, total] = await this.prisma.$transaction([
      this.prisma.exam.findMany({
        where,
        include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
        ...paginationSkipTake(query.page, query.pageSize),
      }),
      this.prisma.exam.count({ where }),
    ]);

    const items: ExamListItem[] = exams
      .filter((e) => e.versions[0])
      .map((e) => {
        const v = e.versions[0]!;
        return {
          id: e.id,
          code: e.code,
          name: e.name,
          trainingProgramId: e.trainingProgramId,
          activeVersionId: e.activeVersionId,
          updatedAt: e.updatedAt,
          latestVersion: {
            id: v.id,
            versionNumber: v.versionNumber,
            status: v.status,
            questionCount: v.questionCount,
            totalMarks: v.totalMarks,
            passPercentage: Number(v.passPercentage),
            levelId: v.levelId,
          },
        };
      });

    return buildPaginatedResult(items, total, query.page, query.pageSize);
  }

  async get(id: string): Promise<ExamDetail> {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: { program: { select: { id: true, title: true } } },
    });
    if (!exam) {
      throw new NotFoundException('Exam not found');
    }
    const versions = await this.prisma.examVersion.findMany({
      where: { examId: id },
      orderBy: { versionNumber: 'desc' },
      select: VERSION_SELECT,
    });
    const latestRow = versions[0];
    if (!latestRow) {
      throw new NotFoundException('Exam not found');
    }

    return {
      id: exam.id,
      code: exam.code,
      name: exam.name,
      description: exam.description,
      trainingProgramId: exam.trainingProgramId,
      program: exam.program,
      activeVersionId: exam.activeVersionId,
      createdAt: exam.createdAt,
      updatedAt: exam.updatedAt,
      latestVersion: this.toVersionSummary(latestRow, exam.activeVersionId),
      versions: versions.map((v) => this.toVersionSummary(v, exam.activeVersionId)),
    };
  }

  async create(dto: CreateExamDto, actorId: string): Promise<ExamDetail> {
    await this.assertProgramAndLevelCompatible(dto.trainingProgramId, dto.levelId);
    await this.assertCodeAvailable(dto.code);

    const exam = await this.prisma.$transaction(async (tx) => {
      const created = await tx.exam.create({
        data: {
          code: dto.code,
          name: dto.name,
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          trainingProgramId: dto.trainingProgramId,
          createdById: actorId,
        },
      });
      await tx.examVersion.create({
        data: {
          examId: created.id,
          versionNumber: 1,
          levelId: dto.levelId,
          ...(dto.questionCount !== undefined ? { questionCount: dto.questionCount } : {}),
          ...(dto.marksPerQuestion !== undefined ? { marksPerQuestion: dto.marksPerQuestion } : {}),
          ...(dto.totalMarks !== undefined ? { totalMarks: dto.totalMarks } : {}),
          ...(dto.passPercentage !== undefined ? { passPercentage: dto.passPercentage } : {}),
          ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
          ...(dto.maxAttempts !== undefined ? { maxAttempts: dto.maxAttempts } : {}),
          createdById: actorId,
        },
      });
      return created;
    });

    await this.audit.record({
      action: AuditAction.EXAM_CREATED,
      entity: 'exam',
      entityId: exam.id,
      actorId,
      metadata: { code: dto.code },
    });

    return this.get(exam.id);
  }

  async update(id: string, dto: UpdateExamDto, actorId: string): Promise<ExamDetail> {
    const { exam, latest } = await loadLatestExamVersion(this.prisma, id);

    const { name, description, ...versionFields } = dto;
    const hasExamFieldChange = name !== undefined || description !== undefined;
    const hasVersionFieldChange = Object.values(versionFields).some((v) => v !== undefined);

    if (versionFields.levelId !== undefined) {
      await this.assertProgramAndLevelCompatible(exam.trainingProgramId, versionFields.levelId);
    }

    if (hasExamFieldChange) {
      await this.prisma.exam.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      });
      await this.audit.record({
        action: AuditAction.EXAM_UPDATED,
        entity: 'exam',
        entityId: id,
        actorId,
      });
    }

    if (hasVersionFieldChange) {
      if (latest.status === ExamVersionStatus.DRAFT) {
        await this.prisma.examVersion.update({
          where: { id: latest.id },
          data: versionFields,
        });
        await this.audit.record({
          action: AuditAction.EXAM_UPDATED,
          entity: 'exam',
          entityId: id,
          actorId,
          metadata: { versionId: latest.id },
        });
      } else {
        const newVersionNumber = latest.versionNumber + 1;
        const created = await this.prisma.examVersion.create({
          data: {
            examId: id,
            versionNumber: newVersionNumber,
            levelId: versionFields.levelId ?? latest.levelId,
            questionCount: versionFields.questionCount ?? latest.questionCount,
            marksPerQuestion: versionFields.marksPerQuestion ?? latest.marksPerQuestion,
            totalMarks: versionFields.totalMarks ?? latest.totalMarks,
            passPercentage: versionFields.passPercentage ?? latest.passPercentage,
            durationMinutes: versionFields.durationMinutes ?? latest.durationMinutes,
            maxAttempts: versionFields.maxAttempts ?? latest.maxAttempts,
            createdById: actorId,
          },
        });
        await this.audit.record({
          action: AuditAction.EXAM_VERSION_CREATED,
          entity: 'exam',
          entityId: id,
          actorId,
          metadata: {
            versionNumber: newVersionNumber,
            precedingVersionId: latest.id,
            newVersionId: created.id,
          },
        });
      }
    }

    return this.get(id);
  }

  async transition(id: string, action: ExamVersionAction, actorId: string): Promise<ExamDetail> {
    const { exam, latest } = await loadLatestExamVersion(this.prisma, id);
    const nextStatus = nextExamVersionStatus(latest.status, action);

    if (action === 'ACTIVATE') {
      const validation = await this.blueprintValidation.validate(latest.id);
      if (!validation.valid) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ExamErrorCode.BLUEPRINT_VALIDATION_FAILED,
          `This exam version's blueprint is not valid: ${validation.errors.join(' ')}`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.examVersion.update({
        where: { id: latest.id },
        data: {
          status: nextStatus,
          ...(action === 'ACTIVATE' ? { activatedAt: new Date() } : {}),
        },
      });

      if (action === 'ACTIVATE') {
        if (exam.activeVersionId && exam.activeVersionId !== latest.id) {
          await tx.examVersion.update({
            where: { id: exam.activeVersionId },
            data: { status: ExamVersionStatus.INACTIVE },
          });
        }
        await tx.exam.update({ where: { id }, data: { activeVersionId: latest.id } });
      } else if (action === 'DEACTIVATE' && exam.activeVersionId === latest.id) {
        await tx.exam.update({ where: { id }, data: { activeVersionId: null } });
      }
    });

    await this.audit.record({
      action: this.auditActionForTransition(action),
      entity: 'exam',
      entityId: id,
      actorId,
      metadata: { action, versionId: latest.id, from: latest.status, to: nextStatus },
    });

    return this.get(id);
  }

  private toVersionSummary(row: VersionRow, activeVersionId: string | null): ExamVersionSummary {
    return {
      id: row.id,
      versionNumber: row.versionNumber,
      status: row.status,
      isActiveVersion: row.id === activeVersionId,
      levelId: row.levelId,
      level: row.level,
      questionCount: row.questionCount,
      marksPerQuestion: Number(row.marksPerQuestion),
      totalMarks: row.totalMarks,
      passPercentage: Number(row.passPercentage),
      durationMinutes: row.durationMinutes,
      maxAttempts: row.maxAttempts,
      hasBlueprint: row.blueprint !== null,
      createdBy: row.createdBy,
      activatedAt: row.activatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private auditActionForTransition(action: ExamVersionAction): AuditAction {
    switch (action) {
      case 'ACTIVATE':
        return AuditAction.EXAM_ACTIVATED;
      case 'DEACTIVATE':
        return AuditAction.EXAM_DEACTIVATED;
      case 'ARCHIVE':
        return AuditAction.EXAM_ARCHIVED;
      case 'RESTORE':
      default:
        return AuditAction.EXAM_UPDATED;
    }
  }

  private async assertCodeAvailable(code: string): Promise<void> {
    const existing = await this.prisma.exam.findUnique({ where: { code } });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamErrorCode.DUPLICATE_EXAM_CODE,
        `An exam with code "${code}" already exists.`,
      );
    }
  }

  private async assertProgramAndLevelCompatible(
    trainingProgramId: string,
    levelId: string,
  ): Promise<void> {
    const program = await this.prisma.trainingProgram.findUnique({
      where: { id: trainingProgramId },
    });
    if (!program) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.REFERENCE_NOT_FOUND,
        'Training program not found.',
      );
    }
    const level = await this.prisma.trainingLevel.findUnique({ where: { id: levelId } });
    if (!level) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.REFERENCE_NOT_FOUND,
        'Training level not found.',
      );
    }
    if (level.programId !== trainingProgramId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ContentErrorCode.REFERENCE_NOT_FOUND,
        'This training level does not belong to the selected training program.',
      );
    }
  }
}
