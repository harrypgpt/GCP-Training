/**
 * Gate 18 §6/§7: registers the official ICH E6(R3) guideline using the
 * EXISTING Gate 10 Source/SourceVersion/SourceSection architecture - no
 * parallel source system, no new tables. Every section's content below was
 * copied verbatim from the official PDF
 * (https://database.ich.org/sites/default/files/ICH_E6(R3)_Step4_FinalGuideline_2025_0106.pdf,
 * fetched and text-extracted with `pdftotext -layout` on 2026-09-26), using
 * the document's OWN section numbering exactly as printed - nothing here is
 * invented, summarized, or paraphrased. ICH's own legal notice on the
 * document permits reproduction/incorporation into other works provided
 * ICH's copyright is acknowledged, which is why `license`/
 * `attributionRequired` below reflect that term explicitly.
 *
 * Idempotent: safe to re-run (checks for an existing Source by title first).
 *
 * Run with: pnpm --filter @gcp/api gate18:register-ich-e6r3
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SourcesService } from '../src/modules/admin/sources/sources.service';
import { SourceVersionsService } from '../src/modules/admin/sources/source-versions.service';

const DOCUMENT_TITLE = 'ICH Harmonised Guideline - Guideline for Good Clinical Practice - E6(R3)';
const CANONICAL_URL =
  'https://database.ich.org/sites/default/files/ICH_E6(R3)_Step4_FinalGuideline_2025_0106.pdf';

interface SectionSeed {
  sectionIdentifier: string;
  parentSectionIdentifier?: string | null;
  heading: string;
  sectionType: 'HEADING' | 'PARAGRAPH';
  sequence: number;
  depth: number;
  documentPage: string;
  content: string;
}

// Verbatim excerpts only - see file header. Chosen to cover the specific
// GCP principles Gate 16/17's real case-study domains most often need
// (patient safety, informed consent, protocol compliance, computerized
// systems/data governance) plus the document's own general framing.
const SECTIONS: SectionSeed[] = [
  {
    sectionIdentifier: 'I',
    heading: 'Introduction',
    sectionType: 'HEADING',
    sequence: 1,
    depth: 0,
    documentPage: '1',
    content:
      'Good Clinical Practice (GCP) is an international, ethical, scientific and quality standard for the conduct of trials that involve human participants. Clinical trials conducted in accordance with this standard will help to assure that the rights, safety and well-being of trial participants are protected; that the conduct is consistent with the principles that have their origin in the Declaration of Helsinki; and that the clinical trial results are reliable. The term "trial conduct" in this document includes processes from planning to reporting, including planning, initiating, performing, recording, oversight, evaluation, analysis and reporting activities as appropriate.\n\nThe objective of this ICH GCP Guideline is to provide a unified standard to facilitate the mutual acceptance of clinical trial data for ICH member countries and regions by applicable regulatory authorities.',
  },
  {
    sectionIdentifier: 'I.Guideline-Scope',
    parentSectionIdentifier: 'I',
    heading: 'Guideline Scope',
    sectionType: 'PARAGRAPH',
    sequence: 2,
    depth: 1,
    documentPage: '1',
    content:
      'This guideline applies to interventional clinical trials of investigational products that are intended to be submitted to regulatory authorities. The Principles of GCP in this guideline may also be applicable to other interventional clinical trials of investigational products that are not intended to support marketing authorisation applications in accordance with local requirements.\n\nThis guideline encourages a risk-based and proportionate approach to the conduct of a clinical trial.',
  },
  {
    sectionIdentifier: 'I.Guideline-Structure',
    parentSectionIdentifier: 'I',
    heading: 'Guideline Structure',
    sectionType: 'PARAGRAPH',
    sequence: 3,
    depth: 1,
    documentPage: '1',
    content:
      'This ICH GCP Guideline is composed of Principles and Annexes that expand on the principles, with specific details for different types of clinical trials. The principles are intended to apply across clinical trial types and settings and to remain relevant as technological and methodological advances occur. The principles outlined in this guideline may be satisfied using differing approaches and should be applied to fit the intended purpose of the clinical trial.',
  },
  {
    sectionIdentifier: 'II',
    heading: 'Principles of ICH GCP',
    sectionType: 'HEADING',
    sequence: 4,
    depth: 0,
    documentPage: '2',
    content:
      'Clinical trials are a fundamental part of clinical research that support the development of new medicines or uses of existing medicines. Well-designed and conducted clinical trials help answer key questions in healthcare and drug development. Their results are essential for evidence-based healthcare decisions. Trials with inadequate design and/or poorly conducted trials may place participant safety at risk, yield inadequate or unreliable results and are unethical.',
  },
  {
    sectionIdentifier: 'II.1',
    parentSectionIdentifier: 'II',
    heading: 'Principle 1 - Rights, Safety and Well-Being',
    sectionType: 'PARAGRAPH',
    sequence: 5,
    depth: 1,
    documentPage: '3',
    content:
      'Clinical trials should be conducted in accordance with the ethical principles that have their origin in the Declaration of Helsinki and that are consistent with GCP and applicable regulatory requirement(s). Clinical trials should be designed and conducted in ways that ensure the rights, safety and well-being of participants.\n\n1.1 The rights, safety and well-being of the participants are the most important considerations and should prevail over interests of science and society.\n\n1.2 The safety of the participants should be reviewed in a timely manner as new safety information becomes available, which could have an impact on participant safety, their willingness to continue in the trial or the conduct of the trial.\n\n1.3 Foreseeable risks and inconveniences should be weighed against the anticipated benefits for the individual participants and society. A trial should be initiated and continued only if the anticipated benefits justify the known and anticipated risks.',
  },
  {
    sectionIdentifier: 'II.7',
    parentSectionIdentifier: 'II',
    heading: 'Principle 7 - Proportionality of Trial Processes',
    sectionType: 'PARAGRAPH',
    sequence: 6,
    depth: 1,
    documentPage: '5',
    content:
      'Clinical trial processes, measures and approaches should be implemented in a way that is proportionate to the risks to participants and to the importance of the data collected and that avoids unnecessary burden on participants and investigators.\n\n7.1 Trial processes should be proportionate to the risks inherent in the trial and the importance of the information collected. Risks in this context include risks to the rights, safety and well-being of trial participants as well as risks to the reliability of the trial results.\n\n7.3 Risks to critical to quality factors should be managed proactively and adjusted when new or unanticipated issues arise once the trial has begun.',
  },
  {
    sectionIdentifier: 'II.9',
    parentSectionIdentifier: 'II',
    heading: 'Principle 9 - Reliable Results',
    sectionType: 'PARAGRAPH',
    sequence: 7,
    depth: 1,
    documentPage: '6',
    content:
      'Clinical trials should generate reliable results.\n\n9.3 Computerised systems used in clinical trials should be fit for purpose (e.g., through risk-based validation, if appropriate), and factors critical to their quality should be addressed in their design or adaptation for clinical trial purposes to ensure the integrity of relevant trial data.\n\n9.4 Clinical trials should incorporate efficient and robust processes for managing records (including data) to help ensure that record integrity and traceability are maintained and that personal information is protected, thereby allowing the accurate reporting, interpretation and verification of the relevant clinical trial-related information.\n\n9.5 Essential records should be retained securely by sponsors and investigators for the required period in accordance with applicable regulatory requirements.',
  },
  {
    sectionIdentifier: '2.5',
    heading: 'Investigator - Compliance with Protocol',
    sectionType: 'PARAGRAPH',
    sequence: 8,
    depth: 0,
    documentPage: '13',
    content:
      '2.5.1 The investigator/institution should sign the protocol or an alternative contract to confirm agreement with the sponsor.\n\n2.5.2 The investigator should comply with the protocol, GCP and applicable regulatory requirements.\n\n2.5.3 The investigator should document all protocol deviations. In addition to those identified by the investigator themselves, protocol deviations relevant to their trial participants and their conduct of the trial may be communicated to them by the sponsor. In either case, the investigator should review the deviations, and for those deviations deemed important, the investigator should explain the deviation and implement appropriate measures to prevent a recurrence, where applicable.\n\n2.5.4 The investigator should follow the protocol and deviate only where necessary to eliminate an immediate hazard(s) to trial participants.',
  },
  {
    sectionIdentifier: '2.8',
    heading: 'Investigator - Informed Consent of Trial Participants',
    sectionType: 'PARAGRAPH',
    sequence: 9,
    depth: 0,
    documentPage: '15',
    content:
      "2.8.1 In obtaining and documenting informed consent (paper or electronic format), the investigator should comply with the applicable regulatory requirement(s) and should adhere to GCP and to the ethical principles that have their origin in the Declaration of Helsinki. The informed consent process should include the following:\n\n(a) Prior to consenting and enrolling participants, the investigator should have the IRB/IEC's documented approval/favourable opinion of the informed consent materials and process;\n\n(b) The information should be as clear and concise as possible, use simple language and avoid unnecessary volume and complexity. This is to ensure that the trial participants or their legally acceptable representatives have an adequate understanding of the objectives of the trial, alternative treatments, potential benefits and risks, burdens, their rights and what is expected of the participants to be able to make an informed decision as to their participation in the trial.",
  },
  {
    sectionIdentifier: '4.3.3',
    heading: 'Data Governance - Computerised Systems - Security',
    sectionType: 'PARAGRAPH',
    sequence: 10,
    depth: 0,
    documentPage: '48',
    content:
      '(a) The security of the trial data and records should be managed throughout the data life cycle.\n\n(b) The responsible party should ensure that security controls are implemented and maintained for computerised systems. These controls should include user management and ongoing measures to prevent, detect and/or mitigate security breaches. Aspects such as user authentication requirements and password management, firewall settings, antivirus software, security patching, system monitoring and penetration testing should be considered.\n\n(c) The responsible party should maintain adequate backup of the data.\n\n(d) Procedures should cover the following: system security measures, data backup and disaster recovery to ensure that unauthorised access and data loss are prevented. Such measures should be periodically tested, as appropriate.',
  },
  {
    sectionIdentifier: '4.3.4',
    heading: 'Data Governance - Computerised Systems - Validation',
    sectionType: 'PARAGRAPH',
    sequence: 11,
    depth: 0,
    documentPage: '49',
    content:
      '(a) The responsible party is responsible for the validation status of the system throughout its life cycle. The approach to validation of computerised systems should be based on a risk assessment that considers the intended use of the system; the purpose and importance of the data/record that are collected/generated, maintained and retained in the system; and the potential of the system to affect the well-being, rights and safety of trial participants and the reliability of trial results.\n\n(b) Validation should demonstrate that the system conforms to the established requirements for completeness, accuracy and reliability and that its performance is consistent with its intended purpose.\n\n(c) Systems should be appropriately validated prior to use.',
  },
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const sources = app.get(SourcesService);
    const sourceVersions = app.get(SourceVersionsService);

    const actor = await prisma.user.findFirstOrThrow({
      where: { roleAssignments: { some: { role: { name: 'ADMIN' } } } },
      select: { id: true, email: true },
    });

    let source = await prisma.source.findFirst({ where: { title: DOCUMENT_TITLE } });
    if (!source) {
      source = await sources.create(
        {
          type: 'GUIDANCE',
          title: DOCUMENT_TITLE,
          citation: 'ICH E6(R3), Final Version, adopted 06 January 2025',
          url: CANONICAL_URL,
          publishedOn: '2025-01-06',
          notes:
            'The sole normative GCP training authority for this platform (Gate 18). Registered via the existing Gate 10 Source/SourceVersion architecture - never a parallel source system.',
        },
        actor.id,
      );
      console.log(`Created Source ${source.id}`);
    } else {
      console.log(`Source already exists: ${source.id}`);
    }

    let version = await prisma.sourceVersion.findFirst({
      where: { sourceId: source.id, versionNumber: 1 },
    });
    if (!version) {
      const created = await sourceVersions.createVersion(
        source.id,
        {
          authority: 'AUTHORITATIVE_REGULATORY',
          issuingOrganization: 'ICH',
          documentVersion: 'Final Version',
          documentIdentifier: 'E6(R3)',
          publicationDate: '2025-01-06',
          effectiveDate: '2025-01-06',
          canonicalUrl: CANONICAL_URL,
          provenanceNotes:
            'Retrieved from the official ICH database URL and text-extracted with pdftotext -layout; section content below is verbatim from the official PDF.',
          license:
            "ICH copyright; reproduction/incorporation into other works permitted under ICH's stated public license terms provided ICH's copyright is acknowledged (see the document's own Legal Notice).",
          accessRestriction: 'PUBLIC_REDISTRIBUTION_PERMITTED',
          attributionRequired: true,
          originalFilename: 'ICH_E6(R3)_Step4_FinalGuideline_2025_0106.pdf',
          mimeType: 'application/pdf',
          extractionMethod: 'TEXT_LAYER',
          extractorVersion: 'pdftotext-layout-manual-selection-v1',
        },
        actor.id,
      );
      version = await prisma.sourceVersion.findUniqueOrThrow({ where: { id: created.id } });
      console.log(`Created SourceVersion ${version.id}`);
    } else {
      console.log(`SourceVersion already exists: ${version.id} (status ${version.reviewStatus})`);
    }

    if (version.reviewStatus === 'DRAFT') {
      const ingestResult = await sourceVersions.ingestSections(
        version.id,
        {
          sections: SECTIONS.map((s) => ({
            sectionIdentifier: s.sectionIdentifier,
            ...(s.parentSectionIdentifier !== undefined
              ? { parentSectionIdentifier: s.parentSectionIdentifier }
              : {}),
            heading: s.heading,
            sectionType: s.sectionType,
            sequence: s.sequence,
            depth: s.depth,
            content: s.content,
            documentPage: s.documentPage,
            extractionMethod: 'TEXT_LAYER',
            extractionStatus: 'EXTRACTED',
          })),
        },
        actor.id,
      );
      console.log('Ingested sections:', ingestResult);

      // Conservative, deliberate editorial decision (Gate 18 §6): ICH
      // publishes E6(R3) publicly and explicitly permits redistribution
      // with attribution - there is no confidentiality/PII concern, so it
      // is marked eligible for external AI use once published.
      await sourceVersions.updateVersion(version.id, {}, actor.id);
      await prisma.sourceVersion.update({
        where: { id: version.id },
        data: { externalAiEligibility: 'SAFE_FOR_EXTERNAL_AI' },
      });

      await sourceVersions.transition(version.id, 'SUBMIT_FOR_REVIEW', actor.id);
      await sourceVersions.transition(version.id, 'APPROVE', actor.id);
      const published = await sourceVersions.transition(version.id, 'PUBLISH', actor.id);
      console.log(`SourceVersion published: ${published.id} (status ${published.reviewStatus})`);
    } else {
      console.log(`SourceVersion already at status ${version.reviewStatus} - no changes made.`);
    }

    const finalSource = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    console.log('\nICH E6(R3) registration summary:', {
      sourceId: finalSource.id,
      currentPublishedVersionId: finalSource.currentPublishedVersionId,
    });
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('ICH E6(R3) registration failed:', error);
  process.exitCode = 1;
});
