/**
 * Gate 29 Section 3/37: registers the COMPLETE official ICH E6(R3) guideline
 * as a new SourceVersion (v2) of the already-registered Source, using the
 * EXISTING Gate 10 Source/SourceVersion/SourceSection architecture - no
 * parallel document repository. v1 (11 sections, a deliberately partial
 * excerpt from Gate 18) remains untouched, PUBLISHED, and fully valid for
 * every real question that already cites it; v2 (68 sections) becomes the
 * new "current" version once published, mirroring exactly how
 * Question.currentPublishedVersionId already moves forward without
 * mutating superseded rows.
 *
 * Every section's content below was copied verbatim from the official PDF
 * (`C:\Users\Milan\Desktop\ICH_E6(R3)_Step4_FinalGuideline_2025_0106.pdf`),
 * text-extracted with `pdftotext -layout` and mechanically (not AI-)
 * reassembled: wrapped lines rejoined into paragraphs, page headers/footers
 * stripped, 37 PDF-font-encoding replacement characters (mostly bullet
 * glyphs) normalized to a plain hyphen. Nothing was summarized, paraphrased,
 * or invented - see docs/gate29-... for the full reconciliation against the
 * PDF's own table of contents.
 *
 * externalAiEligibility has no HTTP endpoint (confirmed: neither
 * CreateSourceVersionDto nor UpdateSourceVersionDto expose it) - set via a
 * direct Prisma update exactly as Gate 18's own registration script already
 * did for v1, not a new deviation.
 *
 * Run with: pnpm --filter @gcp/api gate29:register-complete-ich-e6r3
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/modules/auth/token.service';

const ADMIN_EMAIL = 'data-import-admin@gcp-training.local';
const DOCUMENT_TITLE = 'ICH Harmonised Guideline - Guideline for Good Clinical Practice - E6(R3)';
const CANONICAL_URL =
  'https://database.ich.org/sites/default/files/ICH_E6(R3)_Step4_FinalGuideline_2025_0106.pdf';

interface FinalSection {
  sectionIdentifier: string;
  parentSectionIdentifier: string | null;
  heading: string;
  depth: number;
  sequence: number;
  content: string;
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.listen(0);
  const baseUrl = await app.getUrl();

  try {
    const prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);

    async function req(
      method: 'GET' | 'POST' | 'PATCH',
      path: string,
      token: string,
      body?: Record<string, unknown>,
    ): Promise<{ status: number; body: unknown }> {
      const res = await fetch(`${baseUrl}/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }

    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
      include: { roleAssignments: { include: { role: true } } },
    });
    const adminToken = tokens.signAccessToken(
      admin.id,
      admin.roleAssignments.map((a) => a.role.name),
    ).token;

    const source = await prisma.source.findFirstOrThrow({ where: { title: DOCUMENT_TITLE } });
    console.log(
      `Source: ${source.id} (currentPublishedVersionId=${source.currentPublishedVersionId})`,
    );

    const sectionsPath = join(__dirname, '_tmp', 'final-sections.json');
    const sections = JSON.parse(readFileSync(sectionsPath, 'utf8')) as FinalSection[];
    console.log(`Loaded ${sections.length} sections from the real, extracted PDF text.`);

    // Reuse an already-created DRAFT v2 if a prior run got this far (idempotent re-run).
    const existingDraft = await prisma.sourceVersion.findFirst({
      where: { sourceId: source.id, reviewStatus: 'DRAFT' },
      orderBy: { versionNumber: 'desc' },
    });

    const createRes = existingDraft
      ? { status: 201, body: { id: existingDraft.id, versionNumber: existingDraft.versionNumber } }
      : await req('POST', `/admin/sources/${source.id}/versions`, adminToken, {
          authority: 'AUTHORITATIVE_REGULATORY',
          issuingOrganization: 'ICH',
          documentVersion: 'Final Version',
          documentIdentifier: 'E6(R3)',
          publicationDate: '2025-01-06',
          effectiveDate: '2025-01-06',
          canonicalUrl: CANONICAL_URL,
          provenanceNotes:
            "Gate 29: complete re-registration from the official PDF (68 sections, full document text), superseding v1's deliberately partial 11-section excerpt from Gate 18. Retrieved from the official ICH database URL and text-extracted with pdftotext -layout; content below is verbatim from the official PDF (37 unrecoverable font-encoding replacement characters, mostly bullet glyphs, normalized to a plain hyphen - documented in the Gate 29 report).",
          license:
            "ICH copyright; reproduction/incorporation into other works permitted under ICH's stated public license terms provided ICH's copyright is acknowledged (see the document's own Legal Notice).",
          accessRestriction: 'PUBLIC_REDISTRIBUTION_PERMITTED',
          attributionRequired: true,
          originalFilename: 'ICH_E6(R3)_Step4_FinalGuideline_2025_0106.pdf',
          mimeType: 'application/pdf',
          extractionMethod: 'TEXT_LAYER',
          extractorVersion: 'pdftotext-layout-manual-selection-v2-gate29',
        });
    console.log(`create-version -> HTTP ${createRes.status}`);
    if (createRes.status !== 201) {
      console.log(JSON.stringify(createRes.body));
      throw new Error('Failed to create SourceVersion v2');
    }
    const versionId = (createRes.body as { id: string }).id;
    const versionNumber = (createRes.body as { versionNumber: number }).versionNumber;
    console.log(`Created SourceVersion ${versionId} (versionNumber=${versionNumber})`);

    // Batched: the full 68-section payload exceeds the default body-parser
    // limit in one request. ingestSections is upsert-based (identifier +
    // contentHash), so batching is safe and idempotent.
    const BATCH_SIZE = 10;
    let ingestBody: unknown = { batches: [] };
    for (let i = 0; i < sections.length; i += BATCH_SIZE) {
      const batch = sections.slice(i, i + BATCH_SIZE);
      const ingestRes = await req(
        'POST',
        `/admin/source-versions/${versionId}/sections`,
        adminToken,
        {
          sections: batch.map((s) => ({
            sectionIdentifier: s.sectionIdentifier,
            ...(s.parentSectionIdentifier
              ? { parentSectionIdentifier: s.parentSectionIdentifier }
              : {}),
            heading: s.heading,
            sectionType: s.depth === 0 ? 'HEADING' : 'PARAGRAPH',
            sequence: s.sequence,
            depth: s.depth,
            content: s.content,
            extractionMethod: 'TEXT_LAYER',
            extractionStatus: 'EXTRACTED',
          })),
        },
      );
      console.log(
        `ingest-sections batch ${i / BATCH_SIZE + 1} (${batch.map((b) => b.sectionIdentifier).join(',')}) -> HTTP ${ingestRes.status}`,
      );
      if (ingestRes.status !== 201 && ingestRes.status !== 200) {
        console.log(JSON.stringify(ingestRes.body));
        throw new Error(`Section ingestion failed at batch starting index ${i}`);
      }
      (ingestBody as { batches: unknown[] }).batches.push(ingestRes.body);
    }

    // No HTTP endpoint exposes externalAiEligibility (confirmed in both
    // CreateSourceVersionDto and UpdateSourceVersionDto) - direct update,
    // mirroring Gate 18's own original registration script exactly.
    await prisma.sourceVersion.update({
      where: { id: versionId },
      data: { externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI' },
    });
    console.log(
      'Set externalAiEligibility = SAFE_FOR_EXTERNAL_AI (direct update, same as Gate 18 precedent).',
    );

    const submitRes = await req('PATCH', `/admin/source-versions/${versionId}/status`, adminToken, {
      action: 'SUBMIT_FOR_REVIEW',
    });
    console.log(`submit-for-review -> HTTP ${submitRes.status}`);
    const approveRes = await req(
      'PATCH',
      `/admin/source-versions/${versionId}/status`,
      adminToken,
      { action: 'APPROVE' },
    );
    console.log(`approve -> HTTP ${approveRes.status}`);
    const publishRes = await req(
      'PATCH',
      `/admin/source-versions/${versionId}/status`,
      adminToken,
      { action: 'PUBLISH' },
    );
    console.log(`publish -> HTTP ${publishRes.status}`);
    if (submitRes.status !== 200 || approveRes.status !== 200 || publishRes.status !== 200) {
      console.log(
        JSON.stringify({
          submitRes: submitRes.body,
          approveRes: approveRes.body,
          publishRes: publishRes.body,
        }),
      );
      throw new Error('Workflow transition failed');
    }

    const finalSource = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    const registeredSections = await prisma.sourceSection.findMany({
      where: { sourceVersionId: versionId },
      select: { sectionIdentifier: true, heading: true, parentSectionId: true },
      orderBy: { sequence: 'asc' },
    });

    const report = {
      generatedAt: new Date().toISOString(),
      sourceId: source.id,
      newVersionId: versionId,
      newVersionNumber: versionNumber,
      sourceCurrentPublishedVersionId: finalSource.currentPublishedVersionId,
      totalSectionsRegistered: registeredSections.length,
      registeredSectionIdentifiers: registeredSections.map((s) => s.sectionIdentifier),
      ingestResult: ingestBody,
    };
    writeFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'data',
        'imports',
        'observations',
        'reports',
        'gate29-ich-e6r3-complete-registration-report.json',
      ),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `\nDone. New current published SourceVersion: ${finalSource.currentPublishedVersionId} (v${versionNumber}), ${registeredSections.length} sections.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Gate 29 ICH E6(R3) complete registration failed:', error);
  process.exitCode = 1;
});
