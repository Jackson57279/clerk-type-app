import type { Pool } from "pg";
import type { AuditLogStore, AuditEventRecord } from "./audit-log.js";

export interface PostgresAuditLogStoreOptions {
  pool: Pool;
}

export function createPostgresAuditLogStore(
  options: PostgresAuditLogStoreOptions
): AuditLogStore {
  const { pool } = options;

  return {
    async append(event: AuditEventRecord): Promise<void> {
      await pool.query(
        `INSERT INTO audit_logs (
          event_type, event_id, actor_type, actor_id, actor_email,
          target_type, target_id, ip_address, user_agent, organization_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          event.eventType,
          event.eventId,
          event.actorType ?? null,
          event.actorId ?? null,
          event.actorEmail ?? null,
          event.targetType ?? null,
          event.targetId ?? null,
          event.ipAddress ?? null,
          event.userAgent ?? null,
          event.organizationId ?? null,
          JSON.stringify(event.metadata ?? {}),
        ]
      );
    },
  };
}
