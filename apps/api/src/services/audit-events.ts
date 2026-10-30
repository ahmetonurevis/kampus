import { and, count, desc, eq, gte, lt, notLike, type SQL } from 'drizzle-orm'

import { roleSchema } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { memberships, users } from '../db/schema/auth.ts'
import { dayRange } from './list-filters.ts'

/**
 * İşlem geçmişi (DOM-YTK-053): yalnız yönetici, yalnız kendi kurumu. Yanıt `audit_log`'un
 * görünür alt kümesidir: zaman, işlem, varlık, yapan kişi, alan adları ve gerekçe. Değer, mesaj
 * metni, istek kimliği, IP özeti ve `changes.reason` (teknik hata kodu) dönmez. Okumanın kendisi
 * denetim kaydı üretmez; üretseydi her sayfa görüntüleme yeni kayıt doğurur, liste kendi
 * okumasıyla büyürdü (sonsuz döngü). Kimlik olayları (`auth.*`: giriş, çıkış, kurum değiştirme,
 * parola) okul işlemi değil güvenlik kaydıdır; en az veri ilkesiyle bu listede yer almaz.
 */

/** Kimlik olayı eylem öneki; işlem geçmişi yanıtından süzülür. */
export const AUTH_ACTION_PREFIX = 'auth.'

export interface AuditEventQuery {
  page: number
  pageSize: number
  dateFrom?: string | undefined
  dateTo?: string | undefined
  createdBefore?: string | undefined
  actorUserId?: string | undefined
  entityType?: string | undefined
}

/** Rehberlik varlıkları: koleksiyon ve komut adları (`workflow.guidance`, `workflow.guidance-note`). */
const GUIDANCE_ENTITIES = new Set(['guidanceCases', 'guidance', 'guidance-note'])

/**
 * Rehberlik kaydı (iç not) DOM-YTK-020 gereği "var mı" düzeyinde bile sezdirilmez: alan adı ve
 * kayıt kimliği dönmez, işlem adı tek değere iner. Yalnız "rehberlik kaydı değişti" okunur.
 */
export function isGuidanceEntry(entry: {
  action: string
  entityType: string | null
  entityId: string | null
}): boolean {
  if (entry.entityType !== null && GUIDANCE_ENTITIES.has(entry.entityType)) return true
  if (entry.action.startsWith('workflow.') && GUIDANCE_ENTITIES.has(entry.action.slice(9)))
    return true
  return entry.entityType === 'workflow' && GUIDANCE_ENTITIES.has(entry.entityId ?? '')
}

export const GUIDANCE_ACTION = 'workflow.guidance'
export const GUIDANCE_ENTITY_TYPE = 'guidanceCases'

function stringFields(changes: { fields?: unknown } | null): string[] {
  const fields = changes?.fields
  return Array.isArray(fields)
    ? fields.filter((field): field is string => typeof field === 'string')
    : []
}

/** Kurumun denetim kayıtları, en yeniden eskiye; kurum yalnız `institutionId`'den gelir. */
export async function listAuditEvents(db: Database, institutionId: string, query: AuditEventQuery) {
  const filters: SQL[] = [
    eq(auditLog.institutionId, institutionId),
    notLike(auditLog.action, `${AUTH_ACTION_PREFIX}%`),
  ]
  const range = dayRange('createdAt', query.dateFrom, query.dateTo)
  if (range?.fromInstant) filters.push(gte(auditLog.createdAt, new Date(range.fromInstant)))
  if (range?.toInstant) filters.push(lt(auditLog.createdAt, new Date(range.toInstant)))
  if (query.createdBefore) filters.push(lt(auditLog.createdAt, new Date(query.createdBefore)))
  if (query.actorUserId) filters.push(eq(auditLog.actorUserId, query.actorUserId))
  if (query.entityType) filters.push(eq(auditLog.entityType, query.entityType))
  const where = and(...filters)

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        actorUserId: auditLog.actorUserId,
        actorRole: auditLog.actorRole,
        actorName: users.name,
        membershipRole: memberships.role,
        changes: auditLog.changes,
        reason: auditLog.reason,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .leftJoin(
        memberships,
        and(
          eq(memberships.institutionId, auditLog.institutionId),
          eq(memberships.userId, auditLog.actorUserId),
        ),
      )
      .where(where)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(auditLog).where(where),
  ])

  return {
    items: rows.map((row) => {
      const guidance = isGuidanceEntry(row)
      const role = roleSchema.safeParse(row.actorRole ?? row.membershipRole)
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: guidance ? GUIDANCE_ACTION : row.action,
        entityType: guidance ? GUIDANCE_ENTITY_TYPE : row.entityType,
        entityId: guidance ? null : row.entityId,
        actor:
          row.actorUserId === null
            ? null
            : {
                userId: row.actorUserId,
                name: row.actorName,
                role: role.success ? role.data : null,
              },
        fields: guidance ? [] : stringFields(row.changes),
        reason: guidance ? null : row.reason,
      }
    }),
    total: totals?.total ?? 0,
  }
}
