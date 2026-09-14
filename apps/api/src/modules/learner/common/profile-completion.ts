import { type LearnerProfile } from '@prisma/client';

/**
 * A profile is "complete" once every field the platform needs to
 * personalise training (name, professional context) is filled in. Computed
 * on every read — never stored — so it can never drift from the actual data.
 */
export function isProfileComplete(profile: LearnerProfile): boolean {
  return Boolean(
    profile.firstName &&
      profile.lastName &&
      profile.organization &&
      profile.country &&
      profile.professionalRoleId &&
      profile.yearsOfExperience !== null,
  );
}
