import { Injectable } from '@nestjs/common';

import { ContentStatus } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

export interface AvailableLevelView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export interface AvailableProgramView {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  levels: AvailableLevelView[];
}

export interface ProfessionalRoleOption {
  id: string;
  code: string;
  name: string;
}

/** The learner-facing training catalog: published programs/levels only. */
@Injectable()
export class LearnerProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAvailablePrograms(): Promise<AvailableProgramView[]> {
    const programs = await this.prisma.trainingProgram.findMany({
      where: {
        reviewStatus: ContentStatus.PUBLISHED,
        levels: { some: { reviewStatus: ContentStatus.PUBLISHED } },
      },
      include: {
        levels: {
          where: { reviewStatus: ContentStatus.PUBLISHED },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { title: 'asc' },
    });

    return programs.map((program) => ({
      id: program.id,
      slug: program.slug,
      title: program.title,
      description: program.description,
      levels: program.levels.map((level) => ({
        id: level.id,
        code: level.code,
        name: level.name,
        description: level.description,
        sortOrder: level.sortOrder,
      })),
    }));
  }

  async listProfessionalRoles(): Promise<ProfessionalRoleOption[]> {
    const roles = await this.prisma.professionalRole.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return roles.map((role) => ({ id: role.id, code: role.code, name: role.name }));
  }
}
