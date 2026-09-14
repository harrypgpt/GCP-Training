import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { type LessonCompletionResult, ProgressService } from './progress.service';

@Controller('learner/progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  /**
   * Intentionally takes NO body. Completion is derived entirely from
   * server-side state (enrollment, hierarchy, publication, unlock) — a
   * learner cannot influence the outcome by sending `{ progress: 100 }` or
   * anything else, because nothing in the request is used except identity
   * (from the access token) and the lesson id (from the URL).
   */
  @Post('lessons/:lessonId/complete')
  @HttpCode(HttpStatus.OK)
  completeLesson(
    @Param('lessonId') lessonId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<LessonCompletionResult> {
    return this.progress.completeLesson(user.id, lessonId);
  }
}
