import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { LevelQueryDto } from './dto/level-query.dto';
import { SubmitExamDto } from './dto/submit-exam.dto';
import { LearnerExamAttemptService } from './learner-exam-attempt.service';
import { LearnerExamScoringService } from './learner-exam-scoring.service';

/**
 * Every method is scoped to `@CurrentUser()` - a learner can only ever start
 * or read their own exam attempts through this controller (mirrors
 * `EnrollmentsController`'s "self-scoped, no extra @Roles()" convention,
 * since every learner/* route in this codebase is authenticated-only and
 * scoped to the caller's own data, never role-restricted).
 *
 * The request body is intentionally empty on every route: the server alone
 * determines the active ExamVersion, the blueprint, the selected questions,
 * their order, and option order. The learner supplies only route
 * parameters identifying WHAT to start or read - never WHAT to select.
 */
@Controller('learner/exams')
export class LearnerExamsController {
  constructor(
    private readonly attempts: LearnerExamAttemptService,
    private readonly scoring: LearnerExamScoringService,
  ) {}

  @Post(':examId/start')
  @HttpCode(HttpStatus.OK)
  start(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<LearnerExamAttemptService['startExam']> {
    return this.attempts.startExam(user.id, examId);
  }

  /**
   * Gate 9: purely informational - resolves which exam corresponds to one
   * of the caller's own enrolled levels. Never a second eligibility
   * authority; `start` above re-validates everything regardless of what
   * this reports.
   */
  @Get('current')
  getCurrentExam(
    @Query() query: LevelQueryDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<LearnerExamAttemptService['getCurrentExam']> {
    return this.attempts.getCurrentExam(user.id, query.levelId);
  }

  /** Gate 9: the caller's own attempts for one level, newest first. */
  @Get('attempts')
  listAttempts(
    @Query() query: LevelQueryDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<LearnerExamAttemptService['listAttempts']> {
    return this.attempts.listAttempts(user.id, query.levelId);
  }

  @Get('attempts/:attemptId')
  getAttempt(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<LearnerExamAttemptService['getAttempt']> {
    return this.attempts.getAttempt(user.id, attemptId);
  }

  @Get('attempts/:attemptId/questions')
  getAttemptQuestions(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<LearnerExamAttemptService['getAttemptQuestions']> {
    return this.attempts.getAttemptQuestions(user.id, attemptId);
  }

  /**
   * Gate 7D: authoritative answer submission. The body carries only the
   * learner's selections - the server alone resolves ownership, validates
   * every selection against this attempt's persisted composition, and
   * decides the resulting status. No score, correctness, or pass/fail is
   * ever computed or returned here.
   */
  @Post('attempts/:attemptId/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() dto: SubmitExamDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<LearnerExamAttemptService['submitAttempt']> {
    return this.attempts.submitAttempt(user.id, attemptId, dto);
  }

  /**
   * Gate 7E: authoritative scoring. A plain GET with no request body at all
   * - there is structurally no field for a client to submit a score,
   * percentage, pass/fail, or evaluation timestamp through. The first call
   * that observes a SUBMITTED-but-unevaluated attempt triggers evaluation;
   * every call after that (or from a concurrent request) returns the same
   * finalized result.
   */
  @Get('attempts/:attemptId/result')
  getResult(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<LearnerExamScoringService['getOrEvaluateResult']> {
    return this.scoring.getOrEvaluateResult(user.id, attemptId);
  }
}
