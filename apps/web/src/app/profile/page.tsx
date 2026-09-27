'use client';

import { useEffect, useState, type FormEvent, type JSX } from 'react';

import {
  type AvailableProgram,
  type LearnerProfileView,
  type ProfessionalRoleOption,
} from '@gcp/shared';

import { RequireAuth } from '@/components/auth/require-auth';
import { AppShell } from '@/components/learner/app-shell';
import { ErrorState } from '@/components/learner/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonPage } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { learnerApi } from '@/lib/learner-api';

interface FormState {
  firstName: string;
  lastName: string;
  professionalDesignation: string;
  organization: string;
  country: string;
  professionalRoleId: string;
  yearsOfExperience: string;
  preferredLevelId: string;
}

function toFormState(profile: LearnerProfileView): FormState {
  return {
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    professionalDesignation: profile.professionalDesignation ?? '',
    organization: profile.organization ?? '',
    country: profile.country ?? '',
    professionalRoleId: profile.professionalRole?.id ?? '',
    yearsOfExperience: profile.yearsOfExperience !== null ? String(profile.yearsOfExperience) : '',
    preferredLevelId: profile.preferredLevel?.id ?? '',
  };
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

function ProfileForm(): JSX.Element {
  const [profile, setProfile] = useState<LearnerProfileView | null>(null);
  const [roles, setRoles] = useState<ProfessionalRoleOption[]>([]);
  const [levels, setLevels] = useState<{ id: string; name: string; programTitle: string }[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      learnerApi.getProfile(),
      learnerApi.getProfessionalRoles(),
      learnerApi.getPrograms(),
    ])
      .then(
        ([profileData, roleData, programs]: [
          LearnerProfileView,
          ProfessionalRoleOption[],
          AvailableProgram[],
        ]) => {
          if (cancelled) return;
          setProfile(profileData);
          setForm(toFormState(profileData));
          setRoles(roleData);
          setLevels(
            programs.flatMap((program) =>
              program.levels.map((level) => ({
                id: level.id,
                name: level.name,
                programTitle: program.title,
              })),
            ),
          );
        },
      )
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Unable to load your profile.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!form) return;
    setError(null);
    setSavedMessage(null);
    setSaving(true);
    try {
      const updated = await learnerApi.updateProfile({
        ...(form.firstName ? { firstName: form.firstName } : {}),
        ...(form.lastName ? { lastName: form.lastName } : {}),
        ...(form.professionalDesignation
          ? { professionalDesignation: form.professionalDesignation }
          : {}),
        ...(form.organization ? { organization: form.organization } : {}),
        ...(form.country ? { country: form.country } : {}),
        ...(form.professionalRoleId ? { professionalRoleId: form.professionalRoleId } : {}),
        ...(form.yearsOfExperience !== ''
          ? { yearsOfExperience: Number(form.yearsOfExperience) }
          : {}),
        ...(form.preferredLevelId ? { preferredLevelId: form.preferredLevelId } : {}),
      });
      setProfile(updated);
      setForm(toFormState(updated));
      setSavedMessage('Profile updated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save your profile.');
    } finally {
      setSaving(false);
    }
  }

  if (error && !profile) {
    return (
      <ErrorState
        title="Profile unavailable"
        description={error}
        onRetry={() => setReloadToken((t) => t + 1)}
      />
    );
  }

  if (!profile || !form) {
    return <SkeletonPage label="Loading your profile" />;
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Your profile</CardTitle>
          <Badge tone={profile.isComplete ? 'success' : 'warning'}>
            {profile.isComplete ? 'Complete' : 'Incomplete'}
          </Badge>
        </div>
        <CardDescription>
          This information personalises your training record. Your email, roles and examination
          results are managed separately and cannot be edited here.
        </CardDescription>
      </CardHeader>
      <form className="space-y-5" onSubmit={(e) => void handleSubmit(e)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="firstName" label="First name">
            <input
              id="firstName"
              className={inputClass}
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </Field>
          <Field id="lastName" label="Last name">
            <input
              id="lastName"
              className={inputClass}
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </Field>
        </div>
        <Field id="professionalDesignation" label="Professional designation">
          <input
            id="professionalDesignation"
            className={inputClass}
            placeholder="e.g. RN, MD, PharmD"
            value={form.professionalDesignation}
            onChange={(e) => setForm({ ...form, professionalDesignation: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="organization" label="Organization">
            <input
              id="organization"
              className={inputClass}
              value={form.organization}
              onChange={(e) => setForm({ ...form, organization: e.target.value })}
            />
          </Field>
          <Field id="country" label="Country">
            <input
              id="country"
              className={inputClass}
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="professionalRoleId" label="Professional role">
            <select
              id="professionalRoleId"
              className={inputClass}
              value={form.professionalRoleId}
              onChange={(e) => setForm({ ...form, professionalRoleId: e.target.value })}
            >
              <option value="">Select a role…</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="yearsOfExperience" label="Years of experience">
            <input
              id="yearsOfExperience"
              type="number"
              min={0}
              max={80}
              className={inputClass}
              value={form.yearsOfExperience}
              onChange={(e) => setForm({ ...form, yearsOfExperience: e.target.value })}
            />
          </Field>
        </div>
        <Field id="preferredLevelId" label="Preferred training level">
          <select
            id="preferredLevelId"
            className={inputClass}
            value={form.preferredLevelId}
            onChange={(e) => setForm({ ...form, preferredLevelId: e.target.value })}
          >
            <option value="">No preference</option>
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.programTitle} — {level.name}
              </option>
            ))}
          </select>
        </Field>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {savedMessage && <p className="text-sm text-success">{savedMessage}</p>}

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </form>
    </Card>
  );
}

export default function ProfilePage(): JSX.Element {
  return (
    <RequireAuth>
      <AppShell>
        <h1 className="mb-6 font-serif text-2xl font-semibold text-foreground">Profile</h1>
        <ProfileForm />
      </AppShell>
    </RequireAuth>
  );
}
