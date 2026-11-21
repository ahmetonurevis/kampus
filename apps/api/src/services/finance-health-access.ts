import type { HealthAccessReason } from '@kampus/school-core/lib/finance-health-access.ts'

import type { Database } from '../db/client.ts'
import {
  insertHealthAccessReason,
  listHealthAccessLog,
  type HealthAccessLogFilters,
} from '../db/finance-health-access.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { istanbulDayStart } from './list-filters.ts'

/**
 * Sağlık verisi okuma denetimi (DOM-FIN-156; ON-164; K-523…K-525; DOM-YTK-052). Sağlık ayrıntısı
 * dönen her okuma `recordHealthRead` ile aynı transaction'da denetime düşer: `audit_log` satırı
 * (eylem, kayıt, okuyan, dönen alanların adları; değer yok) ve gerekçe verildiyse
 * `health_access_reasons` satırı (kod, okuyan üyelik, öğrenci). "Diğer" gerekçenin açıklaması
 * `audit_log.reason`'a yazılır. Gerekçe rotada `requireHealthAccessReason` ile zorunlu tutulur;
 * gerekçe sorulmayan rol (veli, öğrenci) `reason: null` verir ve yalnız denetim satırı yazılır.
 * Denetim yazılamazsa transaction geri döner, okuma yanıtı dönmez.
 */

export interface HealthRead {
  /** Denetim eylemi (ör. `finance.incident.read`); günlükteki türü `HEALTH_ACCESS_ACTION_LABELS`. */
  action: string
  entity: { type: string; id: string }
  /** Dönen sağlık alanlarının adları. */
  fields: string[]
  /** Kaydın öğrencisi; personel kaydında ya da öğrencisiz listede `null`. */
  studentId: string | null
  /** Rotadan gelen gerekçe; gerekçe sorulmayan rolde `null`. */
  reason: HealthAccessReason | null
}

export async function recordHealthRead(tx: Database, ctx: ServiceContext, read: HealthRead) {
  const [row] = await tx
    .insert(auditLog)
    .values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: read.action,
      entityType: read.entity.type,
      entityId: read.entity.id,
      changes: { fields: read.fields },
      reason: read.reason?.note ?? null,
      createdAt: ctx.now,
    })
    .returning({ id: auditLog.id })
  if (read.reason === null) return
  if (row === undefined) throw new Error('audit_log insert returned no row')
  await insertHealthAccessReason(tx, ctx.institutionId, {
    auditLogId: row.id,
    actorMembershipId: ctx.actor.membershipId,
    studentId: read.studentId,
    reasonCode: read.reason.code,
    createdAt: ctx.now,
  })
}

const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)

export type HealthAccessLogQuery = Omit<HealthAccessLogFilters, 'fromAt' | 'toAt'> & {
  from?: string | undefined
  to?: string | undefined
}

/**
 * Sağlık verisi erişim günlüğü (yalnız yönetici): kim, ne zaman, hangi kaydı, hangi gerekçeyle
 * açtı. Sağlık değeri dönmez; günlük okuması denetlenmez (sağlık verisi taşımadığından).
 */
export async function listHealthAccessLogFor(ctx: ServiceContext, query: HealthAccessLogQuery) {
  const { from, to, ...rest } = query
  const { items, total } = await listHealthAccessLog(ctx.db, ctx.institutionId, {
    ...rest,
    fromAt: from === undefined ? undefined : new Date(istanbulDayStart(from)),
    toAt: to === undefined ? undefined : new Date(istanbulDayStart(nextDay(to))),
  })
  const studentIds = [
    ...new Set(items.flatMap((item) => (item.studentId === null ? [] : [item.studentId]))),
  ]
  const students =
    studentIds.length === 0
      ? []
      : await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', studentIds, {
          includeArchived: true,
        })
  const names = new Map(
    students.map((row) => [row.id, typeof row.data.name === 'string' ? row.data.name : null]),
  )
  return {
    items: items.map((item) => ({
      id: item.auditLogId,
      accessedAt: item.accessedAt,
      actorMembershipId: item.actorMembershipId,
      actorName: item.actorName,
      actorRole: item.actorRole,
      action: item.action,
      entityType: item.entityType,
      entityId: item.entityId,
      studentId: item.studentId,
      studentName: item.studentId === null ? null : (names.get(item.studentId) ?? null),
      reasonCode: item.reasonCode,
      reasonNote: item.reasonCode === 'other' ? item.reasonNote : null,
    })),
    total,
  }
}
