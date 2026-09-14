import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { EnrollmentsService, type EnrollmentView } from './enrollments.service';

/** Every method is scoped to `@CurrentUser()` — a learner can only ever
 * reach their own enrollments through this controller. */
@Controller('learner/enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<EnrollmentView[]> {
    return this.enrollments.listOwn(user.id);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<EnrollmentView> {
    return this.enrollments.getOwn(user.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateEnrollmentDto,
    @CurrentUser() user: RequestUser,
  ): Promise<EnrollmentView> {
    return this.enrollments.create(user.id, dto);
  }
}
