import { and, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { NotificationAudience } from '@kampus/school-core/lib/notifications.ts'

import type { Database } from './client.ts'
import { records } from './schema/records.ts'

/**
 * Uygulama içi bildirimlerin depo sorguları (core `lib/notifications.ts`). Bildirim
 * `notifications` koleksiyonunda bildirim başına bir kayıttır; kullanıcının okundu işareti
 * `notificationReads` koleksiyonunda `<bildirim>:<kullanıcı>` kimlikli kayıttır ve birincil
 * anahtarla birleştirilir. Görünürlük core `notificationAudienceOf` çıktısıdır: alıcı kitlesi
 * başına öğrenci kimlikleri; burada yalnız SQL'e çevrilir.
 *
 * Sıra deponun sırasıdır (`position`, kimlik; en yeni önce): bildirim yalnız eklenir, ekleme
 * sırası oluşturma sırasıdır.
 */
// TODO(F6-bildirim-indeksi): `(institution_id, data ->> 'studentId', position) where collection =
// 'notifications'` ifade indeksi migration gerektirir; o zamana kadar süzgeç kurumun bildirim
// satırlarını (birincil anahtarın `(institution_id, collection)` önekiyle) tarar.

const NOTIFICATIONS = 'notifications'
const READS = 'notificationReads'
const reads = alias(records, 'notification_reads')

export type AudienceIds = Readonly<Record<NotificationAudience, readonly string[]>>

const field = (name: string) => sql`(${records.data} ->> ${name}::text)`

/** Aktörün gördüğü bildirimler; görebileceği bildirim yoksa `null`. */
function visibleTo(institutionId: string, audience: AudienceIds): SQL | null {
  const parts = Object.entries(audience)
    .filter(([, ids]) => ids.length > 0)
    .map(
      ([kind, ids]) =>
        and(sql`${field('audience')} = ${kind}`, inArray(field('studentId'), [...ids])) as SQL,
    )
  if (parts.length === 0) return null
  return and(
    eq(records.institutionId, institutionId),
    eq(records.collection, NOTIFICATIONS),
    isNull(records.archivedAt),
    or(...parts),
  ) as SQL
}

/** Kullanıcının bu bildirime okundu işareti (birincil anahtarla). */
function readOf(institutionId: string, userId: string): SQL {
  return and(
    eq(reads.institutionId, institutionId),
    eq(reads.collection, READS),
    eq(reads.id, sql`${records.id} || ':' || ${userId}::text`),
    isNull(reads.archivedAt),
  ) as SQL
}

export interface NotificationRow {
  /** Bildirim kaydı; biçim denetimi çağıranındır. */
  data: unknown
  /** Kullanıcının ilk okuma anı; okunmamışsa `null`. */
  readAt: string | null
}

export interface NotificationPage {
  rows: NotificationRow[]
  total: number
}

/** Aktörün bildirim sayfası, en yeni önce; `unread` yalnız okunmamışları verir. */
export async function notificationPage(
  db: Database,
  institutionId: string,
  userId: string,
  audience: AudienceIds,
  { page, pageSize, unread }: { page: number; pageSize: number; unread: boolean },
): Promise<NotificationPage> {
  const visible = visibleTo(institutionId, audience)
  if (visible === null) return { rows: [], total: 0 }
  const where = unread ? (and(visible, isNull(reads.id)) as SQL) : visible
  const [rows, totals] = await Promise.all([
    db
      .select({ data: records.data, readAt: sql<string | null>`${reads.data} ->> 'readAt'` })
      .from(records)
      .leftJoin(reads, readOf(institutionId, userId))
      .where(where)
      .orderBy(desc(records.position), desc(records.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(records)
      .leftJoin(reads, readOf(institutionId, userId))
      .where(where),
  ])
  return { rows, total: totals[0]?.total ?? 0 }
}

/** Aktörün okunmamış bildirim sayısı (core `unreadNotificationCount` ile aynı). */
export async function unreadNotificationTotal(
  db: Database,
  institutionId: string,
  userId: string,
  audience: AudienceIds,
): Promise<number> {
  const visible = visibleTo(institutionId, audience)
  if (visible === null) return 0
  const [row] = await db
    .select({ total: count() })
    .from(records)
    .leftJoin(reads, readOf(institutionId, userId))
    .where(and(visible, isNull(reads.id)))
  return row?.total ?? 0
}
