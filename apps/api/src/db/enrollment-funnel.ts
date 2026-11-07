import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'

import type { FunnelProspect } from '@kampus/school-core/lib/enrollment-funnel.ts'

import type { Database } from './client.ts'
import { recordFilter, type DayRangeMatch } from './records.ts'
import { memberships, users } from './schema/auth.ts'
import { records } from './schema/records.ts'

/**
 * Kayıt hunisinin (DOM-KAY-040) kurum kapsamlı okumaları. Adaydan yalnız hunide okunan alanlar
 * çekilir: ad, telefon, e-posta, not ve veli bilgisi belleğe yüklenmez. Görüşme ve deneme dersi
 * yalnız varlıklarıyla (nesne mi) okunur. Arşivlenen aday sayılmaz.
 */

const isObject = (field: string) =>
  sql<boolean>`coalesce(jsonb_typeof(${records.data} -> ${field}::text), 'null') = 'object'`
const textField = (field: string) => sql<string | null>`(${records.data} ->> ${field}::text)`

/** Kurumun adayları, isteğe bağlı açılış günü aralığıyla (`createdAt`, Europe/Istanbul). */
export async function loadFunnelProspects(
  db: Database,
  institutionId: string,
  range: DayRangeMatch | null,
): Promise<FunnelProspect[]> {
  const filters: SQL[] = [
    eq(records.institutionId, institutionId),
    eq(records.collection, 'prospects'),
    isNull(records.archivedAt),
  ]
  if (range !== null) filters.push(recordFilter(range))
  const rows = await db
    .select({
      source: textField('source'),
      stage: textField('stage'),
      studentId: textField('studentId'),
      trialAt: textField('trialAt'),
      hasMeeting: isObject('meeting'),
      hasTrialLesson: isObject('trialLesson'),
      counselorId: sql<string | null>`(${records.data} -> 'createdBy' ->> 'userId')`,
    })
    .from(records)
    .where(and(...filters))
  return rows.map((row) => ({
    source: row.source,
    stage: row.stage,
    studentId: row.studentId,
    trialAt: row.trialAt,
    meeting: row.hasMeeting ? {} : null,
    trialLesson: row.hasTrialLesson ? {} : null,
    createdBy: { userId: row.counselorId },
  }))
}

/**
 * Danışmanların görünen adları; yalnız kurumun üyesi olan kullanıcılar (başka kurumun ya da silinmiş
 * hesabın adı dönmez). Pasifleştirilmiş üyelik geçmiş adaylarını adıyla korur.
 */
export async function loadCounselorNames(
  db: Database,
  institutionId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ userId: memberships.userId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(eq(memberships.institutionId, institutionId), inArray(memberships.userId, [...userIds])),
    )
  return new Map(rows.map((row) => [row.userId, row.name]))
}
