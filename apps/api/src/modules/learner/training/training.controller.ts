import { Controller, Get, Param } from '@nestjs/common';

import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import {
  type LessonDetailView,
  type LevelDetailView,
  type ModuleDetailView,
  TrainingService,
} from './training.service';

@Controller('learner/training')
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get('levels/:levelId')
  getLevel(
    @Param('levelId') levelId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<LevelDetailView> {
    return this.training.getLevel(user.id, levelId);
  }

  @Get('modules/:moduleId')
  getModule(
    @Param('moduleId') moduleId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ModuleDetailView> {
    return this.training.getModule(user.id, moduleId);
  }

  @Get('lessons/:lessonId')
  getLesson(
    @Param('lessonId') lessonId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<LessonDetailView> {
    return this.training.getLesson(user.id, lessonId);
  }
}
