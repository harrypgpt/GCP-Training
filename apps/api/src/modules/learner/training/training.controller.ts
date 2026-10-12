import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';

import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import {
  type IchE6R3OverviewView,
  type IchE6R3SectionView,
  IchE6R3ReadingService,
} from './ich-e6r3-reading.service';
import {
  type LessonDetailView,
  type LevelDetailView,
  type ModuleDetailView,
  TrainingService,
} from './training.service';

@Controller('learner/training')
export class TrainingController {
  constructor(
    private readonly training: TrainingService,
    private readonly ichReading: IchE6R3ReadingService,
  ) {}

  /**
   * Gate 29: the learner-facing ICH E6(R3) reader's landing view - title,
   * version, adoption date, table of contents, and the learner's own
   * progress. Never returns section content itself (see `getSection`
   * below) and never a downloadable file or raw storage URL (§5).
   */
  @Get('ich-e6r3')
  getIchE6R3Overview(@CurrentUser() user: RequestUser): Promise<IchE6R3OverviewView> {
    return this.ichReading.getOverview(user.id);
  }

  /**
   * One page of the ICH E6(R3) guideline, rendered for in-application
   * display only. Reading this endpoint IS how progress advances - there is
   * no separate "mark as viewed" call the learner could skip or spoof.
   */
  @Get('ich-e6r3/sections/:sequence')
  getIchE6R3Section(
    @Param('sequence', ParseIntPipe) sequence: number,
    @CurrentUser() user: RequestUser,
  ): Promise<IchE6R3SectionView> {
    return this.ichReading.getSection(user.id, sequence);
  }

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
