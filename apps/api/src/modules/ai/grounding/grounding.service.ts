import { HttpStatus, Injectable } from '@nestjs/common';

import { AiErrorCode, ExternalAiEligibility } from '@gcp/shared';

import { AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';

export const GROUNDING_VERSION = 'v1';

export interface GroundingParams {
  sourceId?: string;
  sourceSection?: string;
  caseStudyId?: string;
  observationId?: string;
  learningObjectiveId?: string;
  levelId?: string;
  moduleId?: string;
  professionalRoleId?: string;
  domainId?: string;
}

export interface GroundingRef {
  id: string;
  label: string;
}

/** The bounded, traceable context package handed to an AI provider — never
 * free-form text pulled from wherever, always specific content-bank rows. */
export interface GroundingContext {
  version: string;
  source: (GroundingRef & { citation: string | null }) | null;
  sourceSection: string | null;
  caseStudy:
    | (GroundingRef & { scenario: string; observation: string; context: string | null })
    | null;
  observation: GroundingRef | null;
  learningObjective: GroundingRef | null;
  level: GroundingRef | null;
  module: GroundingRef | null;
  professionalRole: GroundingRef | null;
  domain: GroundingRef | null;
  /** Every real ID actually present in this context — the validator uses
   * this to reject any ID the model claims to have used but that was never
   * actually supplied ("no invented source identifier"). */
  knownIds: Set<string>;
  /** Standing instructions every prompt template includes verbatim. */
  groundingRules: string[];
}

const GROUNDING_RULES = [
  'Use only the supplied evidence for any regulatory claim.',
  'Do not invent citations.',
  'Do not invent source sections.',
  'Do not attribute proprietary observations or case studies to ICH or a regulator.',
  'Clearly distinguish practical experience from regulatory requirements.',
  'If the supplied evidence is insufficient to answer confidently, set insufficientEvidence to true rather than guessing.',
  'Do not fill missing regulatory information using unsupported assumptions.',
];

/**
 * Builds the bounded context package an AI provider is grounded against,
 * and enforces the privacy boundary: proprietary content (case studies,
 * observations) marked INTERNAL_ONLY may never be included when the
 * request is headed to an external provider.
 */
@Injectable()
export class GroundingService {
  constructor(private readonly prisma: PrismaService) {}

  async buildContext(
    params: GroundingParams,
    options: { isExternalProvider: boolean },
  ): Promise<GroundingContext> {
    const [
      source,
      caseStudy,
      observation,
      learningObjective,
      level,
      courseModule,
      professionalRole,
      domain,
    ] = await Promise.all([
      params.sourceId ? this.prisma.source.findUnique({ where: { id: params.sourceId } }) : null,
      params.caseStudyId
        ? this.prisma.caseStudy.findUnique({ where: { id: params.caseStudyId } })
        : null,
      params.observationId
        ? this.prisma.observation.findUnique({ where: { id: params.observationId } })
        : null,
      params.learningObjectiveId
        ? this.prisma.learningObjective.findUnique({ where: { id: params.learningObjectiveId } })
        : null,
      params.levelId
        ? this.prisma.trainingLevel.findUnique({ where: { id: params.levelId } })
        : null,
      params.moduleId ? this.prisma.module.findUnique({ where: { id: params.moduleId } }) : null,
      params.professionalRoleId
        ? this.prisma.professionalRole.findUnique({ where: { id: params.professionalRoleId } })
        : null,
      params.domainId ? this.prisma.gcpDomain.findUnique({ where: { id: params.domainId } }) : null,
    ]);

    if (options.isExternalProvider) {
      if (
        caseStudy &&
        caseStudy.externalAiEligibility !== ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI
      ) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          AiErrorCode.EXTERNAL_CONTENT_BLOCKED,
          'This case study is marked INTERNAL_ONLY and cannot be sent to an external AI provider.',
        );
      }
      if (
        observation &&
        observation.externalAiEligibility !== ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI
      ) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          AiErrorCode.EXTERNAL_CONTENT_BLOCKED,
          'This observation is marked INTERNAL_ONLY and cannot be sent to an external AI provider.',
        );
      }
    }

    const knownIds = new Set<string>();
    for (const entity of [
      source,
      caseStudy,
      observation,
      learningObjective,
      level,
      courseModule,
      professionalRole,
      domain,
    ]) {
      if (entity) knownIds.add(entity.id);
    }

    return {
      version: GROUNDING_VERSION,
      source: source ? { id: source.id, label: source.title, citation: source.citation } : null,
      sourceSection: params.sourceSection ?? null,
      caseStudy: caseStudy
        ? {
            id: caseStudy.id,
            label: `${caseStudy.caseCode} - ${caseStudy.title}`,
            scenario: caseStudy.scenario,
            observation: caseStudy.observation,
            context: caseStudy.context,
          }
        : null,
      observation: observation
        ? {
            id: observation.id,
            label: `${observation.observationCode} - ${observation.description}`,
          }
        : null,
      learningObjective: learningObjective
        ? { id: learningObjective.id, label: learningObjective.description }
        : null,
      level: level ? { id: level.id, label: level.name } : null,
      module: courseModule ? { id: courseModule.id, label: courseModule.title } : null,
      professionalRole: professionalRole
        ? { id: professionalRole.id, label: professionalRole.name }
        : null,
      domain: domain ? { id: domain.id, label: domain.name } : null,
      knownIds,
      groundingRules: GROUNDING_RULES,
    };
  }
}
