import { Injectable, Logger } from '@nestjs/common';

import { type AuditAction } from '@gcp/shared';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface RecordAuditEventInput {
  action: AuditAction;
  /** Logical entity name, e.g. "user", "certificate". */
  entity: string;
  entityId: string;
  /** Null for system-initiated or pre-authentication events. */
  actorId?: string | null;
  /** Structured, non-sensitive context. Never put secrets/PII payloads here. */
  metadata?: Record<string, unknown>;
}

/**
 * Writes to the append-only `audit_log` table. This is the ONLY place in the
 * codebase that should call `prisma.auditLog.create` — every security- or
 * compliance-relevant event goes through here so the audit trail stays
 * consistent and complete.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          entity: input.entity,
          entityId: input.entityId,
          actorId: input.actorId ?? null,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Audit logging must never break the primary request flow. A failure
      // here is itself an operational concern, so it's logged loudly instead.
      this.logger.error(
        `Failed to record audit event "${input.action}" for ${input.entity}:${input.entityId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
