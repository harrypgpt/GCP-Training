import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Mints stable, sequential question codes ("GCP-Q-000001") from a dedicated
 * Postgres sequence (`question_code_seq`) — never from `MAX(code)+1`, which
 * would race under concurrent creation. A code is assigned exactly once, on
 * a question's creation, and never changes across its versions (spec §7).
 */
@Injectable()
export class QuestionCodeService {
  constructor(private readonly prisma: PrismaService) {}

  async nextCode(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('question_code_seq')
    `;
    const value = rows[0]?.nextval;
    if (value === undefined) {
      throw new Error('Failed to allocate a question code from question_code_seq');
    }
    return `GCP-Q-${value.toString().padStart(6, '0')}`;
  }
}
