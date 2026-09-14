import { HttpStatus, Injectable } from '@nestjs/common';

import { LearnerErrorCode } from '@gcp/shared';
import { type LearnerProfile } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { isProfileComplete } from '../common/profile-completion';
import { type UpdateProfileDto } from './dto/update-profile.dto';

export interface ProfileView {
  id: string;
  firstName: string | null;
  lastName: string | null;
  professionalDesignation: string | null;
  organization: string | null;
  country: string | null;
  professionalRole: { id: string; code: string; name: string } | null;
  yearsOfExperience: number | null;
  preferredLevel: { id: string; code: string; name: string } | null;
  isComplete: boolean;
  updatedAt: Date;
}

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every user gets exactly one profile row, created lazily on first touch. */
  private async findOrCreate(userId: string): Promise<LearnerProfile> {
    const existing = await this.prisma.learnerProfile.findUnique({ where: { userId } });
    if (existing) {
      return existing;
    }
    return this.prisma.learnerProfile.create({ data: { userId } });
  }

  async getOwn(userId: string): Promise<ProfileView> {
    const profile = await this.findOrCreate(userId);
    return this.toView(profile);
  }

  async updateOwn(userId: string, dto: UpdateProfileDto): Promise<ProfileView> {
    await this.findOrCreate(userId);

    if (dto.professionalRoleId) {
      const role = await this.prisma.professionalRole.findUnique({
        where: { id: dto.professionalRoleId },
      });
      if (!role) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          LearnerErrorCode.CONTENT_NOT_AVAILABLE,
          'Professional role not found.',
        );
      }
    }
    if (dto.preferredLevelId) {
      const level = await this.prisma.trainingLevel.findUnique({
        where: { id: dto.preferredLevelId },
      });
      if (!level) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          LearnerErrorCode.CONTENT_NOT_AVAILABLE,
          'Training level not found.',
        );
      }
    }

    const updated = await this.prisma.learnerProfile.update({
      where: { userId },
      data: dto,
    });
    return this.toView(updated);
  }

  private async toView(profile: LearnerProfile): Promise<ProfileView> {
    const [professionalRole, preferredLevel] = await Promise.all([
      profile.professionalRoleId
        ? this.prisma.professionalRole.findUnique({ where: { id: profile.professionalRoleId } })
        : null,
      profile.preferredLevelId
        ? this.prisma.trainingLevel.findUnique({ where: { id: profile.preferredLevelId } })
        : null,
    ]);

    return {
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      professionalDesignation: profile.professionalDesignation,
      organization: profile.organization,
      country: profile.country,
      professionalRole: professionalRole
        ? { id: professionalRole.id, code: professionalRole.code, name: professionalRole.name }
        : null,
      yearsOfExperience: profile.yearsOfExperience,
      preferredLevel: preferredLevel
        ? { id: preferredLevel.id, code: preferredLevel.code, name: preferredLevel.name }
        : null,
      isComplete: isProfileComplete(profile),
      updatedAt: profile.updatedAt,
    };
  }
}
