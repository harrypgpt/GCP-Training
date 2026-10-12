import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction, ExamErrorCode } from '@gcp/shared';
import { ExamVersionStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { loadLatestExamVersion } from './exam-common';
import { type BlueprintRuleDto } from './dto/blueprint-rule.dto';
import { type UpsertBlueprintDto } from './dto/upsert-blueprint.dto';
import {
  assertNormativeSectionIsIchAuthoritative,
  findIchE6R3SourceVersions,
} from './ich-e6r3-authority.util';

/** Gate 22 §24: the sum of exactCount/minimumCount required-question
 * counts across a blueprint's active rules must never exceed this -
 * `BlueprintRuleDto`'s own `@ArrayMaxSize(100)` (MAX_BLUEPRINT_RULES) and
 * `@Max(100)` (MAX_REQUIRED_QUESTIONS_PER_RULE) already bound the other two
 * Gate 22 §24 limits at the DTO layer. */
export const MAX_TOTAL_REQUIRED_QUESTIONS = 500;

export interface BlueprintRuleView {
  id: string;
  questionType: string | null;
  difficulty: string | null;
  domainId: string | null;
  domain: { id: string; name: string } | null;
  professionalRoleId: string | null;
  professionalRole: { id: string; name: string } | null;
  levelId: string | null;
  level: { id: string; name: string } | null;
  learningObjectiveId: string | null;
  learningObjective: { id: string; description: string } | null;
  caseStudyRequired: boolean | null;
  sourceRequired: boolean | null;
  normativeSourceSectionId: string | null;
  normativeSourceSection: { id: string; sectionIdentifier: string; heading: string | null } | null;
  questionGenerationType: string | null;
  minimumCount: number | null;
  maximumCount: number | null;
  exactCount: number | null;
  priority: number;
  isActive: boolean;
}

export interface BlueprintDetail {
  id: string;
  examVersionId: string;
  notes: string | null;
  rules: BlueprintRuleView[];
  createdAt: Date;
  updatedAt: Date;
}

const RULE_INCLUDE = {
  domain: { select: { id: true, name: true } },
  professionalRole: { select: { id: true, name: true } },
  level: { select: { id: true, name: true } },
  learningObjective: { select: { id: true, description: true } },
  normativeSourceSection: { select: { id: true, sectionIdentifier: true, heading: true } },
} satisfies Prisma.ExamBlueprintRuleInclude;

const BLUEPRINT_INCLUDE = {
  rules: { include: RULE_INCLUDE, orderBy: { priority: 'desc' } },
} satisfies Prisma.ExamBlueprintInclude;

type BlueprintWithRules = Prisma.ExamBlueprintGetPayload<{ include: typeof BLUEPRINT_INCLUDE }>;

export interface IchE6R3SectionOption {
  id: string;
  sectionIdentifier: string;
  heading: string | null;
}

@Injectable()
export class ExamBlueprintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(examId: string): Promise<BlueprintDetail> {
    const { latest } = await loadLatestExamVersion(this.prisma, examId);
    const blueprint = await this.prisma.examBlueprint.findUnique({
      where: { examVersionId: latest.id },
      include: BLUEPRINT_INCLUDE,
    });
    if (!blueprint) {
      throw new NotFoundException('This exam version has no blueprint configured yet.');
    }
    return this.toDetail(blueprint);
  }

  /** Gate 25 §17: the only sections an admin may pick as a rule's normative
   * requirement - published, authoritative, ICH E6(R3) sections only. No
   * new section inventory: this reads the existing `SourceSection` table,
   * scoped by the same `findIchE6R3SourceVersions` identification Gate 24
   * uses, filtered to versions that are actually `PUBLISHED` and
   * `AUTHORITATIVE_REGULATORY`. */
  async listIchE6R3Sections(): Promise<IchE6R3SectionOption[]> {
    const candidateVersions = await findIchE6R3SourceVersions(this.prisma);
    if (candidateVersions.length === 0) {
      return [];
    }
    const authoritativeVersions = await this.prisma.sourceVersion.findMany({
      where: {
        id: { in: candidateVersions.map((v) => v.id) },
        reviewStatus: 'PUBLISHED',
        authority: 'AUTHORITATIVE_REGULATORY',
      },
      select: { id: true },
    });
    if (authoritativeVersions.length === 0) {
      return [];
    }
    const sections = await this.prisma.sourceSection.findMany({
      where: { sourceVersionId: { in: authoritativeVersions.map((v) => v.id) } },
      orderBy: { sequence: 'asc' },
      select: { id: true, sectionIdentifier: true, heading: true },
    });
    return sections;
  }

  async create(examId: string, dto: UpsertBlueprintDto, actorId: string): Promise<BlueprintDetail> {
    const { latest } = await loadLatestExamVersion(this.prisma, examId);
    this.assertEditable(latest.status);

    const existing = await this.prisma.examBlueprint.findUnique({
      where: { examVersionId: latest.id },
    });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamErrorCode.BLUEPRINT_ALREADY_EXISTS,
        'This exam version already has a blueprint - use PATCH to replace its rules.',
      );
    }

    this.assertVolumeLimits(dto.rules);
    this.assertNoDuplicateNormativeSections(dto.rules);
    await this.assertRuleReferencesExist(dto.rules);

    const created = await this.prisma.examBlueprint.create({
      data: {
        examVersionId: latest.id,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        createdById: actorId,
        rules: { create: dto.rules.map((r) => this.ruleCreateInput(r)) },
      },
      include: BLUEPRINT_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.EXAM_BLUEPRINT_CREATED,
      entity: 'exam',
      entityId: examId,
      actorId,
      metadata: {
        versionId: latest.id,
        ruleCount: dto.rules.length,
        normativeSectionRequirements: this.normativeSectionAuditEntries(dto.rules),
      },
    });

    return this.toDetail(created);
  }

  async replace(
    examId: string,
    dto: UpsertBlueprintDto,
    actorId: string,
  ): Promise<BlueprintDetail> {
    const { latest } = await loadLatestExamVersion(this.prisma, examId);
    this.assertEditable(latest.status);

    const existing = await this.prisma.examBlueprint.findUnique({
      where: { examVersionId: latest.id },
    });
    if (!existing) {
      throw new NotFoundException('This exam version has no blueprint configured yet.');
    }

    this.assertVolumeLimits(dto.rules);
    this.assertNoDuplicateNormativeSections(dto.rules);
    await this.assertRuleReferencesExist(dto.rules);

    await this.prisma.$transaction(async (tx) => {
      await tx.examBlueprint.update({
        where: { id: existing.id },
        data: { ...(dto.notes !== undefined ? { notes: dto.notes } : {}) },
      });
      await tx.examBlueprintRule.deleteMany({ where: { blueprintId: existing.id } });
      if (dto.rules.length > 0) {
        await tx.examBlueprintRule.createMany({
          data: dto.rules.map((r) => ({ blueprintId: existing.id, ...this.ruleCreateInput(r) })),
        });
      }
    });

    await this.audit.record({
      action: AuditAction.EXAM_BLUEPRINT_UPDATED,
      entity: 'exam',
      entityId: examId,
      actorId,
      metadata: {
        versionId: latest.id,
        ruleCount: dto.rules.length,
        normativeSectionRequirements: this.normativeSectionAuditEntries(dto.rules),
      },
    });

    return this.get(examId);
  }

  private assertEditable(status: ExamVersionStatus): void {
    if (status !== ExamVersionStatus.DRAFT) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ExamErrorCode.EXAM_VERSION_NOT_EDITABLE,
        'This exam version is not DRAFT. Create a new exam version to modify its blueprint.',
      );
    }
  }

  private ruleCreateInput(
    r: BlueprintRuleDto,
  ): Prisma.ExamBlueprintRuleCreateWithoutBlueprintInput {
    return {
      ...(r.questionType !== undefined ? { questionType: r.questionType } : {}),
      ...(r.difficulty !== undefined ? { difficulty: r.difficulty } : {}),
      ...(r.domainId !== undefined ? { domainId: r.domainId } : {}),
      ...(r.professionalRoleId !== undefined ? { professionalRoleId: r.professionalRoleId } : {}),
      ...(r.levelId !== undefined ? { levelId: r.levelId } : {}),
      ...(r.learningObjectiveId !== undefined
        ? { learningObjectiveId: r.learningObjectiveId }
        : {}),
      ...(r.caseStudyRequired !== undefined ? { caseStudyRequired: r.caseStudyRequired } : {}),
      ...(r.sourceRequired !== undefined ? { sourceRequired: r.sourceRequired } : {}),
      ...(r.normativeSourceSectionId !== undefined
        ? { normativeSourceSectionId: r.normativeSourceSectionId }
        : {}),
      ...(r.questionGenerationType !== undefined
        ? { questionGenerationType: r.questionGenerationType }
        : {}),
      ...(r.minimumCount !== undefined ? { minimumCount: r.minimumCount } : {}),
      ...(r.maximumCount !== undefined ? { maximumCount: r.maximumCount } : {}),
      ...(r.exactCount !== undefined ? { exactCount: r.exactCount } : {}),
      ...(r.priority !== undefined ? { priority: r.priority } : {}),
      ...(r.isActive !== undefined ? { isActive: r.isActive } : {}),
    };
  }

  /** Gate 22 §24: server-side, never client/UI-trusted. */
  private assertVolumeLimits(rules: BlueprintRuleDto[]): void {
    const total = rules.reduce((sum, r) => sum + (r.exactCount ?? r.minimumCount ?? 0), 0);
    if (total > MAX_TOTAL_REQUIRED_QUESTIONS) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ExamErrorCode.BLUEPRINT_VOLUME_LIMIT_EXCEEDED,
        `The sum of required questions across all rules (${total}) exceeds the maximum of ${MAX_TOTAL_REQUIRED_QUESTIONS}.`,
      );
    }
  }

  /** Gate 25 §12: reject duplicate normative-section requirements within
   * the same submitted rule set - never silently merged or summed. */
  private assertNoDuplicateNormativeSections(rules: BlueprintRuleDto[]): void {
    const sectionIds = rules.map((r) => r.normativeSourceSectionId).filter((v): v is string => !!v);
    const duplicates = sectionIds.filter((id, i) => sectionIds.indexOf(id) !== i);
    if (duplicates.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ExamErrorCode.DUPLICATE_NORMATIVE_SECTION_REQUIREMENT,
        'More than one rule in this blueprint requires the same ICH E6(R3) normative section - use a single rule per section instead.',
      );
    }
  }

  /** Gate 25 §20: which sections this rule set requires, for the audit
   * trail - never a second audit framework, just richer metadata on the
   * existing EXAM_BLUEPRINT_CREATED/UPDATED events. */
  private normativeSectionAuditEntries(rules: BlueprintRuleDto[]): string[] {
    return rules.map((r) => r.normativeSourceSectionId).filter((v): v is string => !!v);
  }

  private async assertRuleReferencesExist(rules: BlueprintRuleDto[]): Promise<void> {
    const domainIds = [...new Set(rules.map((r) => r.domainId).filter((v): v is string => !!v))];
    const roleIds = [
      ...new Set(rules.map((r) => r.professionalRoleId).filter((v): v is string => !!v)),
    ];
    const levelIds = [...new Set(rules.map((r) => r.levelId).filter((v): v is string => !!v))];
    const objectiveIds = [
      ...new Set(rules.map((r) => r.learningObjectiveId).filter((v): v is string => !!v)),
    ];
    const normativeSectionIds = [
      ...new Set(rules.map((r) => r.normativeSourceSectionId).filter((v): v is string => !!v)),
    ];

    // Gate 25 §5: each referenced section must resolve to the registered,
    // published, authoritative ICH E6(R3) source - never an arbitrary UUID.
    await Promise.all(
      normativeSectionIds.map((id) => assertNormativeSectionIsIchAuthoritative(this.prisma, id)),
    );

    const [domains, roles, levels, objectives] = await Promise.all([
      domainIds.length
        ? this.prisma.gcpDomain.findMany({ where: { id: { in: domainIds } }, select: { id: true } })
        : [],
      roleIds.length
        ? this.prisma.professionalRole.findMany({
            where: { id: { in: roleIds } },
            select: { id: true },
          })
        : [],
      levelIds.length
        ? this.prisma.trainingLevel.findMany({
            where: { id: { in: levelIds } },
            select: { id: true },
          })
        : [],
      objectiveIds.length
        ? this.prisma.learningObjective.findMany({
            where: { id: { in: objectiveIds } },
            select: { id: true },
          })
        : [],
    ]);

    if (
      domains.length !== domainIds.length ||
      roles.length !== roleIds.length ||
      levels.length !== levelIds.length ||
      objectives.length !== objectiveIds.length
    ) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ExamErrorCode.BLUEPRINT_VALIDATION_FAILED,
        'One or more blueprint rules reference a domain, role, level or learning objective that does not exist.',
      );
    }
  }

  private toDetail(blueprint: BlueprintWithRules): BlueprintDetail {
    return {
      id: blueprint.id,
      examVersionId: blueprint.examVersionId,
      notes: blueprint.notes,
      createdAt: blueprint.createdAt,
      updatedAt: blueprint.updatedAt,
      rules: blueprint.rules.map((r) => ({
        id: r.id,
        questionType: r.questionType,
        difficulty: r.difficulty,
        domainId: r.domainId,
        domain: r.domain,
        professionalRoleId: r.professionalRoleId,
        professionalRole: r.professionalRole,
        levelId: r.levelId,
        level: r.level,
        learningObjectiveId: r.learningObjectiveId,
        learningObjective: r.learningObjective,
        caseStudyRequired: r.caseStudyRequired,
        sourceRequired: r.sourceRequired,
        normativeSourceSectionId: r.normativeSourceSectionId,
        normativeSourceSection: r.normativeSourceSection,
        questionGenerationType: r.questionGenerationType,
        minimumCount: r.minimumCount,
        maximumCount: r.maximumCount,
        exactCount: r.exactCount,
        priority: r.priority,
        isActive: r.isActive,
      })),
    };
  }
}
