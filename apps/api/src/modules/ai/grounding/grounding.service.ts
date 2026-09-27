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

/** Exported (Gate 17) so the case-study-question-generation prompt can
 * append its own additional rules on top of these standing ones, rather
 * than duplicating this list. */
export const GROUNDING_RULES = [
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
      params.sourceId
        ? this.prisma.source.findUnique({
            where: { id: params.sourceId },
            include: { currentPublishedVersion: { select: { externalAiEligibility: true } } },
          })
        : null,
      params.caseStudyId
        ? this.prisma.caseStudy.findUnique({ where: { id: params.caseStudyId } })
        : null,
      params.observationId
        ? this.prisma.observation.findUnique({
            where: { id: params.observationId },
            include: {
              currentPublishedVersion: {
                select: { externalAiEligibility: true, deIdentificationStatus: true },
              },
            },
          })
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
      // Gate 11 §9/§31: for the richer, versioned observation model, ALL
      // applicable conditions must pass - a currently PUBLISHED version
      // must itself be SAFE_FOR_EXTERNAL_AI *and* have been reviewed and
      // approved for external AI use (de-identification), not merely
      // inherit the legacy flag above. An observation with no published
      // version yet is judged on the legacy flag alone (unchanged
      // behaviour) - this only tightens the boundary once a version exists.
      if (observation?.currentPublishedVersion) {
        const eligible =
          observation.currentPublishedVersion.externalAiEligibility ===
            ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI &&
          observation.currentPublishedVersion.deIdentificationStatus === 'APPROVED_FOR_EXTERNAL_AI';
        if (!eligible) {
          throw new AppException(
            HttpStatus.FORBIDDEN,
            AiErrorCode.EXTERNAL_CONTENT_BLOCKED,
            'This observation version is not both de-identified and marked SAFE_FOR_EXTERNAL_AI, and cannot be sent to an external AI provider.',
          );
        }
      }
      // Gate 10 §26/§19: same boundary, extended to a Source's currently
      // PUBLISHED version. Unknown/no-published-version is treated the same
      // as INTERNAL_ONLY - a source is never sent externally "by default".
      if (
        source &&
        source.currentPublishedVersion?.externalAiEligibility !==
          ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI
      ) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          AiErrorCode.EXTERNAL_CONTENT_BLOCKED,
          'This source is marked INTERNAL_ONLY (or has no eligible published version) and cannot be sent to an external AI provider.',
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

  // -------------------------------------------------------------------
  // Gate 15: case-study generation grounding - built from a
  // CaseStudySpecification's resolved evidence (ObservationVersion(s),
  // training interpretation, domain, roles, learning objective), never
  // from arbitrary browser-supplied IDs. Kept as a separate method/type
  // rather than overloading `buildContext` above, since the shape of what
  // a case-study candidate is grounded on (curated observation fields,
  // risk/severity/root-cause, training interpretation) is meaningfully
  // different from the question-generation grounding shape.
  // -------------------------------------------------------------------

  async buildCaseStudyContext(
    specificationId: string,
    options: { isExternalProvider: boolean },
  ): Promise<CaseStudyGroundingContext> {
    const spec = await this.prisma.caseStudySpecification.findUniqueOrThrow({
      where: { id: specificationId },
      include: {
        domain: true,
        learningObjective: true,
        trainingInterpretation: true,
        professionalRoles: { include: { professionalRole: true } },
        primaryObservationVersion: {
          include: {
            observation: { select: { observationCode: true, externalAiEligibility: true } },
            professionalRoles: { include: { professionalRole: true } },
            domain: true,
          },
        },
        supportingObservations: {
          include: {
            observationVersion: { include: { observation: { select: { observationCode: true } } } },
          },
        },
      },
    });

    const primary = spec.primaryObservationVersion;

    if (options.isExternalProvider) {
      const eligible =
        primary.externalAiEligibility === ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI &&
        primary.deIdentificationStatus === 'APPROVED_FOR_EXTERNAL_AI' &&
        primary.observation.externalAiEligibility === ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI;
      if (!eligible) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          AiErrorCode.EXTERNAL_CONTENT_BLOCKED,
          'The primary observation for this specification is not both de-identified and marked SAFE_FOR_EXTERNAL_AI, and cannot be sent to an external AI provider.',
        );
      }
    }

    const knownIds = new Set<string>([primary.id, primary.observationId]);
    if (spec.domain) knownIds.add(spec.domain.id);
    if (spec.learningObjective) knownIds.add(spec.learningObjective.id);
    if (spec.trainingInterpretation) knownIds.add(spec.trainingInterpretation.id);
    for (const r of spec.professionalRoles) knownIds.add(r.professionalRoleId);
    for (const r of primary.professionalRoles) knownIds.add(r.professionalRoleId);
    for (const s of spec.supportingObservations) {
      knownIds.add(s.observationVersionId);
      knownIds.add(s.observationVersion.observationId);
    }
    if (primary.sourceId) knownIds.add(primary.sourceId);
    if (primary.sourceVersionId) knownIds.add(primary.sourceVersionId);
    if (primary.sourceSectionId) knownIds.add(primary.sourceSectionId);

    return {
      version: GROUNDING_VERSION,
      specificationId: spec.id,
      scenarioType: spec.scenarioType,
      domain: spec.domain
        ? { id: spec.domain.id, label: spec.domain.name }
        : primary.domain
          ? { id: primary.domain.id, label: primary.domain.name }
          : null,
      professionalRoles: (spec.professionalRoles.length > 0
        ? spec.professionalRoles.map((r) => r.professionalRole)
        : primary.professionalRoles.map((r) => r.professionalRole)
      ).map((r) => ({ id: r.id, label: r.name })),
      learningObjective: spec.learningObjective
        ? { id: spec.learningObjective.id, label: spec.learningObjective.title }
        : null,
      trainingInterpretation: spec.trainingInterpretation
        ? { id: spec.trainingInterpretation.id, label: spec.trainingInterpretation.text }
        : null,
      primaryObservation: {
        id: primary.id,
        observationId: primary.observationId,
        label: `${primary.observation.observationCode} - ${primary.originalText.slice(0, 200)}`,
        originalText: primary.originalText,
        severity: primary.severity,
        riskDimensions: primary.riskDimensions,
        rootCauseCategory: primary.rootCauseCategory,
        sourceId: primary.sourceId,
        sourceVersionId: primary.sourceVersionId,
        sourceSectionId: primary.sourceSectionId,
      },
      supportingObservations: spec.supportingObservations.map((s) => ({
        id: s.observationVersionId,
        observationId: s.observationVersion.observationId,
        label: `${s.observationVersion.observation.observationCode}`,
      })),
      desiredDecisionPoint: spec.desiredDecisionPoint,
      expectedLearnerCompetency: spec.expectedLearnerCompetency,
      allowedFactualBoundaries: spec.allowedFactualBoundaries,
      prohibitedAssumptions: spec.prohibitedAssumptions,
      knownIds,
      groundingRules: GROUNDING_RULES,
    };
  }

  // -------------------------------------------------------------------
  // Gate 17: case-study-GROUNDED question generation - builds a context
  // from a pre-existing, already-APPROVED/PUBLISHED CaseStudyVersion (the
  // Gate 15/16 knowledge stack), never from a DRAFT/uncurated one. Kept as
  // its own method/type, exactly like `buildCaseStudyContext` above, rather
  // than widening `GroundingContext` - but returns a real `GroundingContext`
  // (via `context`) so the EXISTING `buildQuestionGenerationPrompt` and
  // `validateAiQuestionOutput` are reused completely unchanged; only the
  // wrapper adds the extra real IDs this gate needs for traceability.
  // -------------------------------------------------------------------

  async buildQuestionContextFromCaseStudy(
    caseStudyVersionId: string,
    options: { isExternalProvider: boolean },
  ): Promise<CaseStudyQuestionGroundingSource> {
    const version = await this.prisma.caseStudyVersion.findUnique({
      where: { id: caseStudyVersionId },
      include: {
        specification: {
          include: {
            domain: true,
            learningObjective: true,
            trainingInterpretation: true,
            professionalRoles: { include: { professionalRole: true } },
            primaryObservationVersion: {
              include: {
                observation: { select: { observationCode: true, externalAiEligibility: true } },
              },
            },
          },
        },
      },
    });
    if (!version) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        AiErrorCode.PROVIDER_UNAVAILABLE,
        'Case-study version not found.',
      );
    }

    // Gate 17 §10: only approved knowledge may ground a question - a DRAFT/
    // GENERATED/READY_FOR_REVIEW/IN_REVIEW candidate is not yet authoritative.
    if (version.status !== 'APPROVED' && version.status !== 'PUBLISHED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.GROUNDING_NOT_APPROVED,
        `This case-study version is in status ${version.status} - only an APPROVED or PUBLISHED version may ground question generation.`,
      );
    }
    const spec = version.specification;
    if (!spec) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.GROUNDING_NOT_APPROVED,
        'This case-study version has no linked specification and cannot be traced back to source evidence.',
      );
    }
    const primary = spec.primaryObservationVersion;
    // Defense in depth (mirrors the Gate 16 specification-creation check):
    // even though the specification pipeline already requires curated
    // evidence and an APPROVED interpretation, re-verify at generation time
    // in case either regressed (e.g. archived) after the case study was
    // approved.
    if (primary.curationStatus !== 'CURATED' && primary.curationStatus !== 'APPROVED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.GROUNDING_NOT_APPROVED,
        'The primary observation backing this case study is no longer curated.',
      );
    }
    if (spec.trainingInterpretation && spec.trainingInterpretation.reviewStatus !== 'APPROVED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.GROUNDING_NOT_APPROVED,
        `The training interpretation backing this case study is in status ${spec.trainingInterpretation.reviewStatus}, not APPROVED.`,
      );
    }

    if (options.isExternalProvider) {
      const eligible =
        primary.externalAiEligibility === ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI &&
        primary.deIdentificationStatus === 'APPROVED_FOR_EXTERNAL_AI' &&
        primary.observation.externalAiEligibility === ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI;
      if (!eligible) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          AiErrorCode.EXTERNAL_CONTENT_BLOCKED,
          'The knowledge backing this case study is not both de-identified and marked SAFE_FOR_EXTERNAL_AI, and cannot be sent to an external AI provider.',
        );
      }
    }

    const knownIds = new Set<string>([
      version.id,
      primary.id,
      primary.observationId,
      ...(spec.domain ? [spec.domain.id] : []),
      ...(spec.learningObjective ? [spec.learningObjective.id] : []),
      ...(spec.trainingInterpretation ? [spec.trainingInterpretation.id] : []),
      ...spec.professionalRoles.map((r) => r.professionalRoleId),
    ]);

    const firstRole = spec.professionalRoles[0]?.professionalRole ?? null;

    const context: GroundingContext = {
      version: GROUNDING_VERSION,
      source: null,
      sourceSection: null,
      // Reuses the existing `caseStudy` slot: `id`/`label` point at the REAL
      // CaseStudyVersion (never the legacy flat CaseStudy), so the
      // validator's "no invented evidence reference" check is checking
      // against genuine, traceable content either way. `context` carries
      // the approved training interpretation text, not a free-text note.
      caseStudy: {
        id: version.id,
        label: `${spec.code} - ${version.title}`,
        scenario: version.scenario,
        observation: primary.originalText,
        context: spec.trainingInterpretation?.text ?? null,
      },
      observation: { id: primary.observationId, label: primary.observation.observationCode },
      learningObjective: spec.learningObjective
        ? { id: spec.learningObjective.id, label: spec.learningObjective.title }
        : null,
      level: null,
      module: null,
      professionalRole: firstRole ? { id: firstRole.id, label: firstRole.name } : null,
      domain: spec.domain ? { id: spec.domain.id, label: spec.domain.name } : null,
      knownIds,
      groundingRules: GROUNDING_RULES,
    };

    return {
      context,
      caseStudyVersionId: version.id,
      specificationId: spec.id,
      observationId: primary.observationId,
      observationType: primary.observationType,
      evidenceClass: primary.evidenceClass,
      trainingInterpretationId: spec.trainingInterpretation?.id ?? null,
      domainId: spec.domain?.id ?? null,
      learningObjectiveId: spec.learningObjective?.id ?? null,
      professionalRoleId: firstRole?.id ?? null,
    };
  }

  // -------------------------------------------------------------------
  // Gate 18 §1/§6/§13: the NORMATIVE_GCP_CONTEXT - approved ICH E6(R3)
  // source/section content ONLY. This is the one and only path by which
  // "what GCP requires" enters a prompt; a real-world observation is NEVER
  // an acceptable substitute, and this method never accepts one.
  // -------------------------------------------------------------------

  /**
   * Loads and validates one or more SourceSections to serve as the
   * NORMATIVE GCP grounding for a question. Fails closed (throws) if:
   *  - a section id does not exist;
   *  - its SourceVersion is not the registered ICH E6(R3) source (Gate 18
   *    §2: "no other document is allowed to silently become a competing
   *    normative GCP authority");
   *  - that SourceVersion is not PUBLISHED (DRAFT/REVIEW/APPROVED/ARCHIVED
   *    are all refused - only a published, immutable version may ground a
   *    question, per Gate 18 §25);
   *  - the SourceVersion is not eligible for an external provider, when
   *    the caller is one.
   */
  async loadNormativeGcpSections(
    sectionIds: string[],
    options: { isExternalProvider: boolean },
  ): Promise<NormativeGcpGroundingResult> {
    if (sectionIds.length === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AiErrorCode.NORMATIVE_GROUNDING_MISSING,
        'At least one ICH E6(R3) source section must be supplied as normative grounding.',
      );
    }

    const sections = await this.prisma.sourceSection.findMany({
      where: { id: { in: sectionIds } },
      include: {
        sourceVersion: { include: { source: { select: { id: true, title: true, type: true } } } },
      },
    });
    if (sections.length !== new Set(sectionIds).size) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AiErrorCode.NORMATIVE_GROUNDING_MISSING,
        'One or more supplied ICH E6(R3) source sections do not exist.',
      );
    }

    const sourceVersionIds = new Set(sections.map((s) => s.sourceVersionId));
    if (sourceVersionIds.size > 1) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AiErrorCode.NORMATIVE_SOURCE_INVALID,
        'All normative source sections for one question must come from the same SourceVersion.',
      );
    }

    const first = sections[0];
    if (!first) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AiErrorCode.NORMATIVE_GROUNDING_MISSING,
        'No normative source sections were resolved.',
      );
    }
    const sourceVersion = first.sourceVersion;

    // Gate 18 §2: the only acceptable normative source is the registered
    // ICH E6(R3) document - identified by its own document identifier, not
    // merely "some regulation-typed Source", so a differently-typed or
    // differently-authored document can never silently qualify.
    const isIchE6R3 =
      sourceVersion.documentIdentifier === 'E6(R3)' && sourceVersion.issuingOrganization === 'ICH';
    if (!isIchE6R3) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        AiErrorCode.NORMATIVE_SOURCE_INVALID,
        'The supplied source section does not belong to the registered ICH E6(R3) guideline - no other document may serve as normative GCP grounding.',
      );
    }

    if (sourceVersion.reviewStatus !== 'PUBLISHED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.GROUNDING_NOT_APPROVED,
        `The ICH E6(R3) source version is in status ${sourceVersion.reviewStatus} - only a PUBLISHED version may ground a question.`,
      );
    }

    if (
      options.isExternalProvider &&
      sourceVersion.externalAiEligibility !== ExternalAiEligibility.SAFE_FOR_EXTERNAL_AI
    ) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        AiErrorCode.EXTERNAL_CONTENT_BLOCKED,
        'This ICH E6(R3) source version is not marked SAFE_FOR_EXTERNAL_AI and cannot be sent to an external AI provider.',
      );
    }

    return {
      sourceId: sourceVersion.source.id,
      sourceVersionId: sourceVersion.id,
      sourceVersionStatus: sourceVersion.reviewStatus,
      sections: sections.map((s) => ({
        id: s.id,
        sectionIdentifier: s.sectionIdentifier,
        heading: s.heading,
        content: s.content,
      })),
    };
  }
}

/** Gate 15: the bounded, traceable context package for case-study
 * generation - built exclusively from a CaseStudySpecification's own
 * server-resolved references (Gate 15 §19). */
export interface CaseStudyGroundingContext {
  version: string;
  specificationId: string;
  scenarioType: string;
  domain: GroundingRef | null;
  professionalRoles: GroundingRef[];
  learningObjective: GroundingRef | null;
  trainingInterpretation: GroundingRef | null;
  primaryObservation: {
    id: string;
    observationId: string;
    label: string;
    originalText: string;
    severity: string;
    riskDimensions: string[];
    rootCauseCategory: string | null;
    sourceId: string | null;
    sourceVersionId: string | null;
    sourceSectionId: string | null;
  };
  supportingObservations: { id: string; observationId: string; label: string }[];
  desiredDecisionPoint: string | null;
  expectedLearnerCompetency: string | null;
  allowedFactualBoundaries: string | null;
  prohibitedAssumptions: string | null;
  knownIds: Set<string>;
  groundingRules: string[];
}

/** Gate 17: the result of grounding a question-generation request on a
 * pre-existing, already-approved CaseStudyVersion. `context` is a real
 * `GroundingContext`, so the existing question prompt builder and validator
 * are reused unchanged; the extra fields are exactly what the caller needs
 * to persist for traceability (Gate 17 §16) without re-querying. */
/** Gate 18: one real, published ICH E6(R3) SourceSection used as normative
 * grounding - `content` is the verbatim, already-ingested text, never
 * AI-rewritten or summarized. */
export interface NormativeGcpSectionRef {
  id: string;
  sectionIdentifier: string;
  heading: string | null;
  content: string;
}

export interface NormativeGcpGroundingResult {
  sourceId: string;
  sourceVersionId: string;
  sourceVersionStatus: string;
  sections: NormativeGcpSectionRef[];
}

export interface CaseStudyQuestionGroundingSource {
  context: GroundingContext;
  caseStudyVersionId: string;
  specificationId: string;
  observationId: string;
  /// Gate 18 §5/§34: the real observation's own classification, so the
  /// caller can deterministically derive `scenarioSourceType` - never an
  /// independent AI classification.
  observationType: string;
  evidenceClass: string;
  trainingInterpretationId: string | null;
  domainId: string | null;
  learningObjectiveId: string | null;
  professionalRoleId: string | null;
}
