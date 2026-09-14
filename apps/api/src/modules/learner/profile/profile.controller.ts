import { Body, Controller, Get, Patch } from '@nestjs/common';

import { CurrentUser } from '../../auth/current-user.decorator';
import { type RequestUser } from '../../auth/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { type ProfileView, ProfileService } from './profile.service';

/** Always operates on the authenticated caller's own profile — there is no
 * id parameter anywhere in this controller, so there is nothing to fake. */
@Controller('learner/profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get(@CurrentUser() user: RequestUser): Promise<ProfileView> {
    return this.profile.getOwn(user.id);
  }

  @Patch()
  update(@Body() dto: UpdateProfileDto, @CurrentUser() user: RequestUser): Promise<ProfileView> {
    return this.profile.updateOwn(user.id, dto);
  }
}
