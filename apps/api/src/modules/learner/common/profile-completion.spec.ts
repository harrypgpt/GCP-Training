import { type LearnerProfile } from '@prisma/client';

import { isProfileComplete } from './profile-completion';

function makeProfile(overrides: Partial<LearnerProfile>): LearnerProfile {
  return {
    id: 'profile-1',
    userId: 'user-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    professionalDesignation: null,
    organization: 'Acme CRO',
    country: 'UK',
    professionalRoleId: 'role-1',
    yearsOfExperience: 5,
    preferredLevelId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('isProfileComplete', () => {
  it('is true when every required field is present', () => {
    expect(isProfileComplete(makeProfile({}))).toBe(true);
  });

  it('treats yearsOfExperience of 0 as present (not missing)', () => {
    expect(isProfileComplete(makeProfile({ yearsOfExperience: 0 }))).toBe(true);
  });

  it.each([
    ['firstName', { firstName: null }],
    ['lastName', { lastName: null }],
    ['organization', { organization: null }],
    ['country', { country: null }],
    ['professionalRoleId', { professionalRoleId: null }],
    ['yearsOfExperience', { yearsOfExperience: null }],
  ])('is false when %s is missing', (_field, overrides) => {
    expect(isProfileComplete(makeProfile(overrides))).toBe(false);
  });

  it('does not require professionalDesignation or preferredLevelId', () => {
    expect(
      isProfileComplete(makeProfile({ professionalDesignation: null, preferredLevelId: null })),
    ).toBe(true);
  });
});
