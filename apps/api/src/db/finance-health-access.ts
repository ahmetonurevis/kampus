import { and, count, desc, eq, gte, lt, type SQL } from 'drizzle-orm'

import type { HealthAccessReasonCode } from '@kampus/school-core/lib/finance-health-access.ts'

import type { Database } from './client.ts'
import { auditLog } from './schema/audit-log.ts'
import { memberships, users } from './schema/auth.ts'
import { healthAccessReasons } from './schema/finance-health-access.ts'

/**
 * Sağlık verisi okuma gerekçesi deposu (DOM-FIN-156; ON-164). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Satır `audit_log` satırıyla aynı transaction'da yazılır ve değişmez; depo
 * güncelleme sunmaz.
 */

const r = healthAccessReasons

export interface HealthAccessReasonInsert {
  auditLogId: string
  actorMembershipId: string
  studentId: string | null
  reasonCode: HealthAccessReasonCode
  createdAt: Date
}

export async function insertHealthAccessReason(
  db: Database,
  institutionId: string,
  row: HealthAccessReasonInsert,
) {
  await db.insert(r).values({ institutionId, ...row, updatedAt: row.createdAt })
}

export interface HealthAccessLogFilters {
  page: number
  pageSize: number
  actorMembershipId?: string | undefined
  studentId?: string | undefined
  reasonCode?: HealthAccessReasonCode | undefined
  fromAt?: Date | undefined
  toAt?: Date | undefined
}

export interface StoredHealthAccessLog {
  auditLogId: string
  accessedAt: string
  actorMembershipId: string
  actorName: string | null
  actorRole: string | null
  action: string
  entityType: string | null
  entityId: string | null
  studentId: string | null
  reasonCode: HealthAccessReasonCode
  reasonNote: string | null
}

/** Günlük: en yeni okuma önce; okuyanın adı üyelikten (üyelik silindiyse boş). */
export async function listHealthAccessLog(
  db: Database,
  institutionId: string,
  query: HealthAccessLogFilters,
): Promise<{ items: StoredHealthAccessLog[]; total: number }> {
  const filters: (SQL | undefined)[] = [
    eq(r.institutionId, institutionId),
    query.actorMembershipId === undefined
      ? undefined
      : eq(r.actorMembershipId, query.actorMembershipId),
    query.studentId === undefined ? undefined : eq(r.studentId, query.studentId),
    query.reasonCode === undefined ? undefined : eq(r.reasonCode, query.reasonCode),
    query.fromAt === undefined ? undefined : gte(r.createdAt, query.fromAt),
    query.toAt === undefined ? undefined : lt(r.createdAt, query.toAt),
  ]
  const where = and(...filters)
  // Gerekçe satırı yalnız aynı kurumun denetim satırıyla eşleşir.
  const audit = and(eq(auditLog.id, r.auditLogId), eq(auditLog.institutionId, r.institutionId))
  const [totalRow] = await db
    .select({ total: count() })
    .from(r)
    .innerJoin(auditLog, audit)
    .where(where)
  const rows = await db
    .select({
      auditLogId: r.auditLogId,
      accessedAt: r.createdAt,
      actorMembershipId: r.actorMembershipId,
      actorName: users.name,
      actorRole: auditLog.actorRole,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      studentId: r.studentId,
      reasonCode: r.reasonCode,
      reasonNote: auditLog.reason,
    })
    .from(r)
    .innerJoin(auditLog, audit)
    .leftJoin(
      memberships,
      and(eq(memberships.institutionId, r.institutionId), eq(memberships.id, r.actorMembershipId)),
    )
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(desc(r.createdAt), desc(r.auditLogId))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((row) => ({
      ...row,
      accessedAt: row.accessedAt.toISOString(),
      actorName: row.actorName ?? null,
    })),
    total: totalRow?.total ?? 0,
  }
}
