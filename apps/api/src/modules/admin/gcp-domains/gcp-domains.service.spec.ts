import { Test } from '@nestjs/testing';

import { AuditAction } from '@gcp/shared';

import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { GcpDomainsService } from './gcp-domains.service';

const DOMAIN = {
  id: 'domain-1',
  code: 'DATA_INTEGRITY',
  name: 'Data Integrity',
  description: 'desc',
  sortOrder: 10,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('GcpDomainsService', () => {
  const domainFindUnique = jest.fn();
  const domainFindMany = jest.fn();
  const domainCount = jest.fn();
  const domainCreate = jest.fn();
  const domainUpdate = jest.fn();
  const roleFindUnique = jest.fn();
  const roleMapFindUnique = jest.fn();
  const roleMapCreate = jest.fn();
  const roleMapFindMany = jest.fn();
  const roleMapDelete = jest.fn();
  const auditRecord = jest.fn();
  const transaction = jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));

  async function createService(): Promise<GcpDomainsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GcpDomainsService,
        {
          provide: PrismaService,
          useValue: {
            gcpDomain: {
              findUnique: domainFindUnique,
              findMany: domainFindMany,
              count: domainCount,
              create: domainCreate,
              update: domainUpdate,
            },
            professionalRole: { findUnique: roleFindUnique },
            gcpDomainRoleMap: {
              findUnique: roleMapFindUnique,
              create: roleMapCreate,
              findMany: roleMapFindMany,
              delete: roleMapDelete,
            },
            $transaction: transaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(GcpDomainsService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    domainFindUnique.mockResolvedValue(null);
    domainFindMany.mockResolvedValue([DOMAIN]);
    domainCount.mockResolvedValue(1);
    domainCreate.mockResolvedValue(DOMAIN);
    domainUpdate.mockResolvedValue({ ...DOMAIN, isActive: false });
    roleFindUnique.mockResolvedValue({ id: 'role-1', code: 'QA', name: 'Quality Assurance' });
    roleMapFindUnique.mockResolvedValue(null);
    roleMapCreate.mockResolvedValue({
      id: 'map-1',
      domainId: 'domain-1',
      professionalRoleId: 'role-1',
      rationale: null,
      createdById: 'user-1',
      createdAt: new Date('2026-01-01'),
      domain: DOMAIN,
      professionalRole: { id: 'role-1', code: 'QA', name: 'Quality Assurance' },
    });
  });

  describe('create (Gate 14 §9 - stable unique codes)', () => {
    it('creates a domain and records GCP_DOMAIN_CREATED', async () => {
      const service = await createService();
      const result = await service.create(
        { code: 'DATA_INTEGRITY', name: 'Data Integrity' },
        'user-1',
      );

      expect(result.code).toBe('DATA_INTEGRITY');
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.GCP_DOMAIN_CREATED }),
      );
    });

    it('rejects a duplicate domain code', async () => {
      domainFindUnique.mockResolvedValue(DOMAIN);
      const service = await createService();

      await expect(
        service.create({ code: 'DATA_INTEGRITY', name: 'Data Integrity' }, 'user-1'),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('retire/restore (Gate 14 §37 - never deletes)', () => {
    it('retires a domain via isActive=false, never delete', async () => {
      domainFindUnique.mockResolvedValue(DOMAIN);
      const service = await createService();

      const result = await service.retire('domain-1', 'user-1');

      expect(result.isActive).toBe(false);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.GCP_DOMAIN_RETIRED }),
      );
    });

    it('restores a retired domain', async () => {
      domainFindUnique.mockResolvedValue({ ...DOMAIN, isActive: false });
      domainUpdate.mockResolvedValue({ ...DOMAIN, isActive: true });
      const service = await createService();

      const result = await service.restore('domain-1', 'user-1');
      expect(result.isActive).toBe(true);
    });
  });

  describe('role-to-domain matrix (Gate 14 §11 - reference view, not permissions)', () => {
    it('creates a mapping entry when domain and role both exist', async () => {
      domainFindUnique.mockResolvedValue(DOMAIN);
      const service = await createService();

      const result = await service.createRoleMapEntry(
        { domainId: 'domain-1', professionalRoleId: 'role-1', rationale: 'Core function.' },
        'user-1',
      );

      expect(result.domainCode).toBe('DATA_INTEGRITY');
      expect(result.professionalRoleCode).toBe('QA');
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.GCP_DOMAIN_ROLE_MAP_CHANGED }),
      );
    });

    it('rejects a duplicate domain/role mapping', async () => {
      domainFindUnique.mockResolvedValue(DOMAIN);
      roleMapFindUnique.mockResolvedValue({ id: 'existing-map' });
      const service = await createService();

      await expect(
        service.createRoleMapEntry(
          { domainId: 'domain-1', professionalRoleId: 'role-1' },
          'user-1',
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rejects mapping an unknown domain', async () => {
      domainFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.createRoleMapEntry({ domainId: 'missing', professionalRoleId: 'role-1' }, 'user-1'),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
