import { Controller, Get } from '@nestjs/common';

import {
  type AvailableProgramView,
  LearnerProgramsService,
  type ProfessionalRoleOption,
} from './programs.service';

@Controller('learner/programs')
export class LearnerProgramsController {
  constructor(private readonly programs: LearnerProgramsService) {}

  @Get()
  list(): Promise<AvailableProgramView[]> {
    return this.programs.listAvailablePrograms();
  }

  @Get('professional-roles')
  professionalRoles(): Promise<ProfessionalRoleOption[]> {
    return this.programs.listProfessionalRoles();
  }
}
