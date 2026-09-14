import { HttpStatus, Injectable } from '@nestjs/common';

import { AiErrorCode, AuditAction } from '@gcp/shared';

import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { type CreateQuestionDto } from '../admin/questions/dto/create-question.dto';
import { type QuestionDetail, QuestionsService } from '../admin/questions/questions.service';
import { AiCandidatesService } from './ai-candidates.service';

/**
 * The ONLY path from an AI candidate into the real question bank. This
 * deliberately calls `QuestionsService.create()` — the exact same method a
 * human author's `POST /admin/questions` request goes through — rather than
 * writing a Question/QuestionVersion directly. That guarantees a converted
 * candidate:
 *   - always lands on a brand-new Question with a fresh v1 DRAFT version
 *   - goes through the identical reference/option validation a human gets
 *   - can never itself be PUBLISHED, APPROVED, or anything but DRAFT
 *   - can never overwrite an existing question
 * There is no second, AI-specific write path into `questions`/`question_versions`
 * anywhere in this codebase.
 */
@Injectable()
export class AiCandidateConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidates: AiCandidatesService,
    private readonly questions: QuestionsService,
    private readonly audit: AuditService,
  ) {}

  async convert(candidateId: string, actorId: string): Promise<QuestionDetail> {
    const candidate = await this.candidates.get(candidateId);

    if (candidate.status !== 'ACCEPTED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.INVALID_CANDIDATE_TRANSITION,
        `Only an ACCEPTED candidate can be converted into a question (current status: ${candidate.status}).`,
      );
    }
    if (candidate.convertedQuestionId) {
      throw new AppException(
        HttpStatus.CONFLICT,
        AiErrorCode.CANDIDATE_ALREADY_CONVERTED,
        'This candidate has already been converted into a question.',
      );
    }

    const createDto: CreateQuestionDto = {
      type: candidate.type,
      stem: candidate.stem,
      ...(candidate.instructions ? { instructions: candidate.instructions } : {}),
      ...(candidate.explanation ? { explanation: candidate.explanation } : {}),
      ...(candidate.rationale ? { rationale: candidate.rationale } : {}),
      difficulty: candidate.difficulty,
      ...(candidate.levelId ? { levelId: candidate.levelId } : {}),
      ...(candidate.domainId ? { domainId: candidate.domainId } : {}),
      ...(candidate.professionalRoleId ? { professionalRoleId: candidate.professionalRoleId } : {}),
      ...(candidate.learningObjectiveId
        ? { learningObjectiveId: candidate.learningObjectiveId }
        : {}),
      ...(candidate.sourceId ? { sourceId: candidate.sourceId } : {}),
      ...(candidate.sourceSection ? { sourceSection: candidate.sourceSection } : {}),
      ...(candidate.observationId ? { observationId: candidate.observationId } : {}),
      caseStudyIds: candidate.caseStudyLinks.map((link) => link.caseStudyId),
      options: candidate.options.map((option) => ({
        label: option.label,
        content: option.content,
        isCorrect: option.isCorrect,
        ...(option.explanation ? { explanation: option.explanation } : {}),
        sortOrder: option.sortOrder,
      })),
    };

    // Always creates a fresh Question + v1 QuestionVersion in DRAFT — the
    // same call site, same validation, same workflow a human author uses.
    const question = await this.questions.create(createDto, actorId);

    await this.prisma.aiQuestionCandidate.update({
      where: { id: candidateId },
      data: {
        convertedQuestionId: question.id,
        convertedQuestionVersionId: question.latestVersion.id,
        convertedAt: new Date(),
      },
    });

    await this.audit.record({
      action: AuditAction.AI_CANDIDATE_CONVERTED,
      entity: 'ai_question_candidate',
      entityId: candidateId,
      actorId,
      metadata: { questionId: question.id, questionVersionId: question.latestVersion.id },
    });

    return question;
  }
}
