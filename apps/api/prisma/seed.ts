/**
 * Database seed.
 *
 * This script seeds ONLY platform infrastructure — the baseline RBAC roles
 * and a starter permission set — never business/educational data. The
 * platform must not present fabricated learners, training content, case
 * studies, questions or certificates, so none are created here.
 *
 * Idempotent: safe to run against an already-seeded database.
 */
import { PrismaClient } from '@prisma/client';

import { UserRole } from '@gcp/shared';

const prisma = new PrismaClient();

/** Baseline roles the platform ships with. Admins can add more later. */
const BASELINE_ROLES: ReadonlyArray<{ name: string; description: string }> = [
  { name: UserRole.LEARNER, description: 'Studies training content and sits examinations.' },
  { name: UserRole.REVIEWER, description: 'Reviews draft content and questions for approval.' },
  {
    name: UserRole.CONTENT_AUTHOR,
    description: 'Authors training content, case studies and questions.',
  },
  { name: UserRole.ADMIN, description: 'Full administrative access to the platform.' },
];

/**
 * Professional roles a learner (or a case study/question) can be tagged
 * with — a platform taxonomy, not regulatory content. Codes are stable
 * identifiers; names are the learner-facing labels.
 */
const PROFESSIONAL_ROLES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'CRA', name: 'Clinical Research Associate' },
  { code: 'CRC', name: 'Clinical Research Coordinator' },
  { code: 'PRINCIPAL_INVESTIGATOR', name: 'Principal Investigator' },
  { code: 'SUB_INVESTIGATOR', name: 'Sub-Investigator' },
  { code: 'SPONSOR', name: 'Sponsor Professional' },
  { code: 'CRO', name: 'CRO Professional' },
  { code: 'CLINICAL_OPERATIONS', name: 'Clinical Operations Professional' },
  { code: 'QA', name: 'Quality Assurance Professional' },
  { code: 'PHARMACOVIGILANCE', name: 'Pharmacovigilance / Safety Professional' },
  { code: 'REGULATORY', name: 'Regulatory Professional' },
  { code: 'PHARMACEUTICAL', name: 'Pharmaceutical Professional' },
  { code: 'OTHER', name: 'Other Clinical Research Professional' },
];

/** A minimal starter permission set, illustrating the RBAC join tables. */
const BASELINE_PERMISSIONS: ReadonlyArray<{ key: string; description: string }> = [
  { key: 'content.read', description: 'View published training content.' },
  { key: 'content.author', description: 'Create and edit draft content.' },
  { key: 'content.publish', description: 'Approve and publish content.' },
  { key: 'question.author', description: 'Create and edit draft questions.' },
  { key: 'question.approve', description: 'Approve questions for examination use.' },
  { key: 'exam.blueprint.manage', description: 'Create and edit exam blueprints.' },
  { key: 'certificate.revoke', description: 'Revoke an issued certificate.' },
  { key: 'user.manage', description: 'Manage user accounts and role assignments.' },
  { key: 'audit.read', description: 'View the audit log.' },
];

async function main(): Promise<void> {
  for (const role of BASELINE_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description, isSystem: true },
      create: { name: role.name, description: role.description, isSystem: true },
    });
  }

  for (const role of PROFESSIONAL_ROLES) {
    await prisma.professionalRole.upsert({
      where: { code: role.code },
      update: { name: role.name },
      create: { code: role.code, name: role.name },
    });
  }

  for (const permission of BASELINE_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: { key: permission.key, description: permission.description },
    });
  }

  // ADMIN gets every baseline permission; other roles get none yet (assigned
  // deliberately, later, once the admin UI exists).
  const admin = await prisma.role.findUniqueOrThrow({ where: { name: UserRole.ADMIN } });
  const allPermissions = await prisma.permission.findMany({ select: { id: true } });
  await prisma.rolePermission.createMany({
    data: allPermissions.map((permission) => ({
      roleId: admin.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  const [users, roles, permissions, professionalRoles, auditEvents] = await Promise.all([
    prisma.user.count(),
    prisma.role.count(),
    prisma.permission.count(),
    prisma.professionalRole.count(),
    prisma.auditLog.count(),
  ]);

  // eslint-disable-next-line no-console
  console.log(
    `[seed] done. users=${users} roles=${roles} permissions=${permissions} ` +
      `professional_roles=${professionalRoles} audit_log=${auditEvents}`,
  );
}

void main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
