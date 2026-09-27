import { createHash } from 'node:crypto';

import { Test } from '@nestjs/testing';

import { AuditAction, SourceErrorCode } from '@gcp/shared';
import { ContentStatus, ExtractionStatus } from '@prisma/client';

import { AuditService } from '../../../common/audit/audit.service';
import { type AppException } from '../../../common/exceptions/app-exception';
import { PrismaService } from '../../../prisma/prisma.service';
import { SourceVersionsService } from './source-versions.service';

const SOURCE = {
  id: 'source-1',
  type: 'REGULATION',
  title: 'ICH E6(R3)',
  currentPublishedVersionId: null as string | null,
};

const VERSION_ROW = {
  id: 'ver-1',
  sourceId: 'source-1',
  versionNumber: 1,
  authority: 'AUTHORITATIVE_REGULATORY',
  issuingOrganization: null,
  jurisdiction: null,
  documentVersion: null,
  revision: null,
  language: null,
  publicationDate: null,
  effectiveDate: null,
  canonicalUrl: null,
  documentIdentifier: null,
  retrievedAt: new Date('2026-01-01'),
  provenanceNotes: null,
  checksum: null,
  extractedContentHash: null,
  reviewStatus: ContentStatus.DRAFT,
  approvedAt: null,
  publishedAt: null,
  archivedAt: null,
  license: null,
  accessRestriction: 'INTERNAL_KNOWLEDGE_ONLY',
  attributionRequired: true,
  externalAiEligibility: 'INTERNAL_ONLY',
  originalFilename: null,
  mimeType: null,
  fileSizeBytes: null,
  extractionMethod: null,
  extractionStatus: ExtractionStatus.PENDING,
  extractorVersion: null,
  ingestionStartedAt: null,
  ingestionCompletedAt: null,
  ingestionError: null,
  createdById: 'user-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  _count: { sections: 0 },
};

describe('SourceVersionsService', () => {
  const sourceFindUnique = jest.fn();
  const sourceFindUniqueOrThrow = jest.fn();
  const sourceVersionFindUnique = jest.fn();
  const sourceVersionFindFirst = jest.fn();
  const sourceVersionFindMany = jest.fn();
  const sourceVersionCount = jest.fn();
  const sourceVersionCreate = jest.fn();
  const sourceVersionUpdate = jest.fn();
  const sourceSectionFindMany = jest.fn();
  const sourceSectionCreate = jest.fn();
  const sourceSectionUpdate = jest.fn();
  const sourceSectionCount = jest.fn();
  const sourceUpdate = jest.fn();
  const relationshipCreate = jest.fn();
  const relationshipFindMany = jest.fn();
  const auditRecord = jest.fn();

  const txClient = {
    source: { update: sourceUpdate },
    sourceVersion: { update: sourceVersionUpdate },
    sourceSection: {
      findMany: sourceSectionFindMany,
      create: sourceSectionCreate,
      update: sourceSectionUpdate,
    },
  };

  const transaction = jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return (arg as (tx: typeof txClient) => Promise<unknown>)(txClient);
  });

  async function createService(): Promise<SourceVersionsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SourceVersionsService,
        {
          provide: PrismaService,
          useValue: {
            source: { findUnique: sourceFindUnique, findUniqueOrThrow: sourceFindUniqueOrThrow },
            sourceVersion: {
              findUnique: sourceVersionFindUnique,
              findFirst: sourceVersionFindFirst,
              findMany: sourceVersionFindMany,
              count: sourceVersionCount,
              create: sourceVersionCreate,
              update: sourceVersionUpdate,
            },
            sourceSection: {
              findMany: sourceSectionFindMany,
              count: sourceSectionCount,
            },
            sourceVersionRelationship: {
              create: relationshipCreate,
              findMany: relationshipFindMany,
            },
            $transaction: transaction,
          },
        },
        { provide: AuditService, useValue: { record: auditRecord } },
      ],
    }).compile();
    return moduleRef.get(SourceVersionsService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    sourceFindUnique.mockResolvedValue(SOURCE);
    sourceFindUniqueOrThrow.mockResolvedValue(SOURCE);
    sourceVersionFindUnique.mockResolvedValue(VERSION_ROW);
    sourceVersionFindFirst.mockResolvedValue(null);
    sourceVersionCreate.mockResolvedValue(VERSION_ROW);
    sourceVersionUpdate.mockResolvedValue(VERSION_ROW);
    sourceSectionFindMany.mockResolvedValue([]);
    sourceSectionCount.mockResolvedValue(0);
    sourceUpdate.mockResolvedValue(SOURCE);
    relationshipCreate.mockResolvedValue({
      id: 'rel-1',
      fromVersionId: 'ver-1',
      toVersionId: 'ver-2',
      relationType: 'SUPERSEDES',
      notes: null,
      createdAt: new Date(),
    });
    relationshipFindMany.mockResolvedValue([]);
  });

  describe('createVersion', () => {
    it('creates the first version of a source at versionNumber 1', async () => {
      const service = await createService();
      const result = await service.createVersion(
        'source-1',
        { authority: 'AUTHORITATIVE_REGULATORY' },
        'user-1',
      );

      expect(result.versionNumber).toBe(1);
      expect(sourceVersionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ versionNumber: 1 }) }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.SOURCE_VERSION_CREATED }),
      );
    });

    it('increments versionNumber from the latest existing version', async () => {
      sourceVersionFindFirst.mockResolvedValueOnce({ versionNumber: 4 });
      const service = await createService();
      await service.createVersion('source-1', { authority: 'OFFICIAL_GUIDANCE' }, 'user-1');

      expect(sourceVersionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ versionNumber: 5 }) }),
      );
    });

    it('rejects when the source does not exist', async () => {
      sourceFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.createVersion('missing', { authority: 'OFFICIAL_GUIDANCE' }, 'user-1'),
      ).rejects.toThrow();
      expect(sourceVersionCreate).not.toHaveBeenCalled();
    });

    it('rejects a checksum that already exists on another version (exact-duplicate detection, Gate 10 §16)', async () => {
      // The duplicate-checksum lookup runs before the "latest version
      // number" lookup, so the first findFirst call is the conflict check.
      sourceVersionFindFirst.mockResolvedValueOnce({
        id: 'ver-9',
        sourceId: 'source-1',
        versionNumber: 3,
      });
      const service = await createService();

      await expect(
        service.createVersion(
          'source-1',
          { authority: 'AUTHORITATIVE_REGULATORY', checksum: 'abc123' },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: SourceErrorCode.DUPLICATE_SOURCE_VERSION });
      expect(sourceVersionCreate).not.toHaveBeenCalled();
    });
  });

  describe('updateVersion (immutability, Gate 10 §38)', () => {
    it('allows updating a DRAFT version', async () => {
      const service = await createService();
      await expect(
        service.updateVersion('ver-1', { jurisdiction: 'US' }, 'user-1'),
      ).resolves.toBeDefined();
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.SOURCE_VERSION_METADATA_CHANGED }),
      );
    });

    it('rejects updating a PUBLISHED version', async () => {
      sourceVersionFindUnique.mockResolvedValue({
        ...VERSION_ROW,
        reviewStatus: ContentStatus.PUBLISHED,
      });
      const service = await createService();

      await expect(
        service.updateVersion('ver-1', { jurisdiction: 'US' }, 'user-1'),
      ).rejects.toMatchObject({ code: SourceErrorCode.VERSION_NOT_EDITABLE });
      expect(sourceVersionUpdate).not.toHaveBeenCalled();
    });

    it('rejects updating an ARCHIVED version', async () => {
      sourceVersionFindUnique.mockResolvedValue({
        ...VERSION_ROW,
        reviewStatus: ContentStatus.ARCHIVED,
      });
      const service = await createService();

      await expect(
        service.updateVersion('ver-1', { jurisdiction: 'US' }, 'user-1'),
      ).rejects.toMatchObject({ code: SourceErrorCode.VERSION_NOT_EDITABLE });
    });

    it('rejects a not-found version', async () => {
      sourceVersionFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.updateVersion('missing', { jurisdiction: 'US' }, 'user-1'),
      ).rejects.toMatchObject({ code: SourceErrorCode.SOURCE_VERSION_NOT_FOUND });
    });
  });

  describe('ingestSections', () => {
    it('creates new sections, computes contentHash, and reports counts', async () => {
      const service = await createService();
      sourceSectionCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: `row-${String(data.sectionIdentifier)}`, ...data }),
      );

      const result = await service.ingestSections(
        'ver-1',
        {
          sections: [
            { sectionIdentifier: '1', sequence: 0, content: 'Introductory text.' },
            { sectionIdentifier: '2', sequence: 1, content: 'Second section text.' },
          ],
        },
        'user-1',
      );

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(sourceSectionCreate).toHaveBeenCalledTimes(2);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.SOURCE_INGESTION_STARTED }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.SOURCE_INGESTION_COMPLETED }),
      );
    });

    it('is idempotent: re-ingesting identical content is a no-op (Gate 10 §39)', async () => {
      const contentHash = createHash('sha256').update('Same text.', 'utf8').digest('hex');
      sourceSectionFindMany.mockResolvedValue([
        { id: 'row-1', sectionIdentifier: '1', contentHash },
      ]);
      const service = await createService();

      const result = await service.ingestSections(
        'ver-1',
        { sections: [{ sectionIdentifier: '1', sequence: 0, content: 'Same text.' }] },
        'user-1',
      );

      expect(result.unchanged).toBe(1);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(sourceSectionCreate).not.toHaveBeenCalled();
      expect(sourceSectionUpdate).not.toHaveBeenCalled();
    });

    it('updates a section in place when its content changed', async () => {
      sourceSectionFindMany.mockResolvedValue([
        { id: 'row-1', sectionIdentifier: '1', contentHash: 'old-hash' },
      ]);
      const service = await createService();

      const result = await service.ingestSections(
        'ver-1',
        { sections: [{ sectionIdentifier: '1', sequence: 0, content: 'Corrected text.' }] },
        'user-1',
      );

      expect(result.updated).toBe(1);
      expect(sourceSectionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'row-1' } }),
      );
    });

    it('rejects ingestion once the version has left DRAFT', async () => {
      sourceVersionFindUnique.mockResolvedValue({
        ...VERSION_ROW,
        reviewStatus: ContentStatus.REVIEW,
      });
      const service = await createService();

      await expect(
        service.ingestSections(
          'ver-1',
          { sections: [{ sectionIdentifier: '1', sequence: 0, content: 'Text.' }] },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: SourceErrorCode.VERSION_NOT_INGESTABLE });
      expect(sourceSectionCreate).not.toHaveBeenCalled();
    });

    it('rejects empty content (Gate 10 §14)', async () => {
      const service = await createService();

      await expect(
        service.ingestSections(
          'ver-1',
          { sections: [{ sectionIdentifier: '1', sequence: 0, content: '   ' }] },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: SourceErrorCode.EMPTY_SECTION_CONTENT });
    });

    it('rejects a duplicate section identifier within the same batch (Gate 10 §14)', async () => {
      const service = await createService();

      await expect(
        service.ingestSections(
          'ver-1',
          {
            sections: [
              { sectionIdentifier: '1', sequence: 0, content: 'A' },
              { sectionIdentifier: '1', sequence: 1, content: 'B' },
            ],
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: SourceErrorCode.DUPLICATE_SECTION_IDENTIFIER });
    });

    it('resolves a parent reference to a sibling created earlier in the same batch', async () => {
      sourceSectionCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: `row-${String(data.sectionIdentifier)}`, ...data }),
      );
      const service = await createService();

      await service.ingestSections(
        'ver-1',
        {
          sections: [
            { sectionIdentifier: '1', sequence: 0, content: 'Parent.' },
            {
              sectionIdentifier: '1.1',
              sequence: 1,
              content: 'Child.',
              parentSectionIdentifier: '1',
            },
          ],
        },
        'user-1',
      );

      expect(sourceSectionUpdate).toHaveBeenCalledWith({
        where: { id: 'row-1.1' },
        data: { parentSectionId: 'row-1' },
      });
    });

    it('rejects an unresolvable parent reference rather than inventing one (Gate 10 §14/§47)', async () => {
      const service = await createService();

      await expect(
        service.ingestSections(
          'ver-1',
          {
            sections: [
              {
                sectionIdentifier: '1.1',
                sequence: 0,
                content: 'Child.',
                parentSectionIdentifier: 'nonexistent',
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: SourceErrorCode.INVALID_PARENT_SECTION });
    });

    it('rejects a section declaring itself as its own parent', async () => {
      const service = await createService();

      await expect(
        service.ingestSections(
          'ver-1',
          {
            sections: [
              { sectionIdentifier: '1', sequence: 0, content: 'A', parentSectionIdentifier: '1' },
            ],
          },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: SourceErrorCode.INVALID_PARENT_SECTION });
    });

    it('records SOURCE_INGESTION_FAILED and marks the version FAILED without leaking a raw error (Gate 10 §40)', async () => {
      sourceSectionCreate.mockRejectedValue(new Error('db exploded with a raw stack trace'));
      const service = await createService();

      await expect(
        service.ingestSections(
          'ver-1',
          { sections: [{ sectionIdentifier: '1', sequence: 0, content: 'Text.' }] },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: SourceErrorCode.VERSION_NOT_INGESTABLE });

      expect(sourceVersionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ extractionStatus: ExtractionStatus.FAILED }),
        }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.SOURCE_INGESTION_FAILED }),
      );
      const failedCall = auditRecord.mock.calls.find(
        (c) => (c[0] as { action: string }).action === AuditAction.SOURCE_INGESTION_FAILED,
      );
      expect(JSON.stringify(failedCall)).not.toContain('raw stack trace');
    });
  });

  describe('transition (publish/archive, Gate 10 §6/§28/§38)', () => {
    it('rejects PUBLISH when the version has zero sections', async () => {
      sourceSectionCount.mockResolvedValue(0);
      sourceVersionFindUnique.mockResolvedValue({
        ...VERSION_ROW,
        reviewStatus: ContentStatus.APPROVED,
      });
      const service = await createService();

      await expect(service.transition('ver-1', 'PUBLISH', 'user-1')).rejects.toMatchObject({
        code: SourceErrorCode.VERSION_NOT_PUBLISHABLE,
      });
    });

    it('publishing sets Source.currentPublishedVersionId and records SOURCE_VERSION_PUBLISHED', async () => {
      sourceSectionCount.mockResolvedValue(3);
      sourceVersionFindUnique.mockResolvedValue({
        ...VERSION_ROW,
        reviewStatus: ContentStatus.APPROVED,
      });
      sourceVersionUpdate.mockResolvedValue({
        ...VERSION_ROW,
        reviewStatus: ContentStatus.PUBLISHED,
      });
      const service = await createService();

      await service.transition('ver-1', 'PUBLISH', 'user-1');

      expect(sourceUpdate).toHaveBeenCalledWith({
        where: { id: 'source-1' },
        data: { currentPublishedVersionId: 'ver-1' },
      });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.SOURCE_VERSION_PUBLISHED }),
      );
    });

    it('does not clear currentPublishedVersionId when archiving a DIFFERENT version', async () => {
      sourceFindUnique.mockResolvedValue({ ...SOURCE, currentPublishedVersionId: 'ver-OTHER' });
      sourceVersionFindUnique.mockResolvedValue({
        ...VERSION_ROW,
        reviewStatus: ContentStatus.APPROVED,
      });
      const service = await createService();

      await service.transition('ver-1', 'ARCHIVE', 'user-1');

      expect(sourceUpdate).not.toHaveBeenCalled();
    });

    it('archiving the CURRENT published version clears Source.currentPublishedVersionId (Gate 10 §6)', async () => {
      sourceFindUnique.mockResolvedValue({ ...SOURCE, currentPublishedVersionId: 'ver-1' });
      sourceVersionFindUnique.mockResolvedValue({
        ...VERSION_ROW,
        reviewStatus: ContentStatus.PUBLISHED,
      });
      const service = await createService();

      await service.transition('ver-1', 'ARCHIVE', 'user-1');

      expect(sourceUpdate).toHaveBeenCalledWith({
        where: { id: 'source-1' },
        data: { currentPublishedVersionId: null },
      });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.SOURCE_VERSION_ARCHIVED }),
      );
    });

    it('rejects an invalid transition (e.g. PUBLISH straight from DRAFT)', async () => {
      const service = await createService();
      let thrown: AppException | undefined;
      try {
        await service.transition('ver-1', 'PUBLISH', 'user-1');
      } catch (e) {
        thrown = e as AppException;
      }
      expect(thrown).toBeDefined();
      expect(thrown?.code).not.toBe(SourceErrorCode.VERSION_NOT_PUBLISHABLE);
    });
  });

  describe('createRelationship (Gate 10 §17)', () => {
    it('creates an explicit relationship between two existing versions', async () => {
      sourceVersionFindUnique
        .mockResolvedValueOnce(VERSION_ROW) // loadVersionWithSource(versionId)
        .mockResolvedValueOnce({ id: 'ver-2' }); // target lookup
      const service = await createService();

      const result = await service.createRelationship(
        'ver-1',
        { toVersionId: 'ver-2', relationType: 'SUPERSEDES' },
        'user-1',
      );

      expect(result.relationType).toBe('SUPERSEDES');
      expect(relationshipCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromVersionId: 'ver-1',
            toVersionId: 'ver-2',
            relationType: 'SUPERSEDES',
          }),
        }),
      );
    });

    it('rejects a relationship to a nonexistent target version', async () => {
      sourceVersionFindUnique.mockResolvedValueOnce(VERSION_ROW).mockResolvedValueOnce(null);
      const service = await createService();

      await expect(
        service.createRelationship(
          'ver-1',
          { toVersionId: 'missing', relationType: 'SUPERSEDES' },
          'user-1',
        ),
      ).rejects.toMatchObject({ code: SourceErrorCode.RELATIONSHIP_VERSION_NOT_FOUND });
      expect(relationshipCreate).not.toHaveBeenCalled();
    });
  });

  describe('listVersionsForSource / getVersion', () => {
    it('marks isCurrentPublished correctly against Source.currentPublishedVersionId', async () => {
      sourceFindUnique.mockResolvedValue({ ...SOURCE, currentPublishedVersionId: 'ver-1' });
      sourceVersionFindMany.mockResolvedValue([VERSION_ROW]);
      sourceVersionCount.mockResolvedValue(1);
      const service = await createService();

      const result = await service.listVersionsForSource('source-1', { page: 1, pageSize: 20 });

      expect(result.items[0]?.isCurrentPublished).toBe(true);
    });

    it('rejects listing versions for a nonexistent source', async () => {
      sourceFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(
        service.listVersionsForSource('missing', { page: 1, pageSize: 20 }),
      ).rejects.toThrow();
    });

    it('rejects getVersion for a nonexistent version', async () => {
      sourceVersionFindUnique.mockResolvedValue(null);
      const service = await createService();

      await expect(service.getVersion('missing')).rejects.toMatchObject({
        code: SourceErrorCode.SOURCE_VERSION_NOT_FOUND,
      });
    });
  });
});
