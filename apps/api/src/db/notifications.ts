import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  max,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type {
  NotificationAudience,
  NotificationRecord,
} from '@kampus/school-core/lib/notifications.ts'

import type { Database } from './client.ts'
import { POSITION_STEP } from './positions.ts'
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
// Süzgeç `records_notifications_idx` ifade indeksini kullanır: `(institution_id, data ->> 'studentId',
// position, id) where collection = 'notifications' and archived_at is null`. İfade ve koşul indeksle
// birebir olmalı; anahtar adı parametre değil sabit metindir (parametreli `data ->> $1` indeksle
// eşleşmez).

const NOTIFICATIONS = 'notifications'
const READS = 'notificationReads'
const reads = alias(records, 'notification_reads')

export type AudienceIds = Readonly<Record<NotificationAudience, readonly string[]>>

const field = (name: 'audience' | 'studentId' | 'kind') =>
  sql`(${records.data} ->> ${sql.raw(`'${name}'`)})`

/**
 * Aktörün gördüğü bildirimler; görebileceği bildirim yoksa `null`. `hiddenKinds` kurumda kapalı
 * modülün türleridir (core `hiddenNotificationKinds`; DOM-YTK-040): satırlar silinmez, süzülür.
 */
export function visibleTo(
  institutionId: string,
  audience: AudienceIds,
  hiddenKinds: readonly string[] = [],
): SQL | null {
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
    ...(hiddenKinds.length > 0 ? [notInArray(field('kind'), [...hiddenKinds])] : []),
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
  /** Bu sayfadan sonra daha eski bildirim var mı. */
  more: boolean
}

/**
 * Aktörün bildirim sayfası, en yeni önce (imleçli; api-tasarimi §3 sürekli büyüyen akış):
 * `cursor` önceki sayfanın en eski bildiriminin kimliğidir ve sayfa ondan eski `limit`
 * bildirimdir. İmleç aktörün görebildiği bir bildirim değilse `null` (rota 400); böylece imleç
 * başkasının bildiriminin varlığını sızdırmaz. `unread` yalnız okunmamışları verir.
 */
export async function notificationPage(
  db: Database,
  institutionId: string,
  userId: string,
  audience: AudienceIds,
  {
    cursor,
    limit,
    unread,
    hiddenKinds = [],
  }: {
    cursor?: string | undefined
    limit: number
    unread: boolean
    hiddenKinds?: readonly string[]
  },
): Promise<NotificationPage | null> {
  const visible = visibleTo(institutionId, audience, hiddenKinds)
  if (visible === null) return cursor === undefined ? { rows: [], more: false } : null
  const where: SQL[] = [visible]
  if (unread) where.push(isNull(reads.id))
  if (cursor !== undefined) {
    const [anchor] = await db
      .select({ position: records.position, id: records.id })
      .from(records)
      .where(and(visible, eq(records.id, cursor)))
      .limit(1)
    if (!anchor) return null
    where.push(sql`(${records.position}, ${records.id}) < (${anchor.position}, ${anchor.id})`)
  }
  const rows = await db
    .select({ data: records.data, readAt: sql<string | null>`${reads.data} ->> 'readAt'` })
    .from(records)
    .leftJoin(reads, readOf(institutionId, userId))
    .where(and(...where))
    .orderBy(desc(records.position), desc(records.id))
    .limit(limit + 1)
  return { rows: rows.slice(0, limit), more: rows.length > limit }
}

/** Aktörün okunmamış bildirim sayısı (core `unreadNotificationCount` ile aynı). */
export async function unreadNotificationTotal(
  db: Database,
  institutionId: string,
  userId: string,
  audience: AudienceIds,
  hiddenKinds: readonly string[] = [],
): Promise<number> {
  const visible = visibleTo(institutionId, audience, hiddenKinds)
  if (visible === null) return 0
  const [row] = await db
    .select({ total: count() })
    .from(records)
    .leftJoin(reads, readOf(institutionId, userId))
    .where(and(visible, isNull(reads.id)))
  return row?.total ?? 0
}

/**
 * Kurumda bulunan öğrenci kimlikleri (arşivlenmiş dahil: ayrılan öğrencinin velisine iade
 * bildirimi gidebilir). Başka kurumun ya da olmayan öğrencinin kimliği dönmez (`notify` alıcı
 * çözümü).
 */
export async function institutionStudentIds(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set()
  const rows = await db
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'students'),
        inArray(records.id, [...studentIds]),
      ),
    )
  return new Set(rows.map((row) => row.id))
}

/**
 * Bildirimleri verilen sırayla koleksiyonun sonuna ekler; aynı kimlikte kayıt (arşivlenmiş dahil)
 * varsa o bildirim atlanır (`notify` `dedupeKey`: aynı olay aynı alıcıya ikinci kez yazılmaz,
 * eşzamanlı iki yazma da tek satır bırakır). Yazılan kimlikleri döndürür. Çağıranın
 * transaction'ında çalışır; ayrı transaction açmaz.
 */
export async function insertNotifications(
  db: Database,
  institutionId: string,
  rows: readonly NotificationRecord[],
  now: Date,
): Promise<string[]> {
  if (rows.length === 0) return []
  const [last] = await db
    .select({ position: max(records.position) })
    .from(records)
    .where(and(eq(records.institutionId, institutionId), eq(records.collection, NOTIFICATIONS)))
  const start =
    last?.position === null || last?.position === undefined
      ? 0
      : Number(last.position) + POSITION_STEP
  const inserted = await db
    .insert(records)
    .values(
      rows.map((row, index) => ({
        institutionId,
        collection: NOTIFICATIONS,
        id: row.id,
        data: row,
        position: start + index * POSITION_STEP,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing({ target: [records.institutionId, records.collection, records.id] })
    .returning({ id: records.id })
  const written = new Set(inserted.map((row) => row.id))
  return rows.filter((row) => written.has(row.id)).map((row) => row.id)
}
