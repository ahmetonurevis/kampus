import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'

import type { Database } from './client.ts'
import { records } from './schema/records.ts'

/**
 * Yazışma mesajlarının depo sorguları (ADR 0005). Mesajlar `records` tablosunda
 * `conversationMessages` koleksiyonunda, mesaj başına bir kayıttır. Sorgular
 * `records_conversation_messages_idx` indeksinin ifadesini ve koşulunu birebir kullanır:
 * `(data ->> 'conversationId')`, `collection = 'conversationMessages'`, `archived_at is null`.
 * Sıra deponun sırasıdır (`position`, kimlik) ve core dizisindeki eklenme sırasıyla aynıdır.
 */

const MESSAGES = 'conversationMessages'
const conversationOf = sql`(${records.data} ->> 'conversationId')`

function messagesOf(institutionId: string, conversationId: string): SQL {
  return and(
    eq(records.institutionId, institutionId),
    eq(records.collection, MESSAGES),
    isNull(records.archivedAt),
    sql`${conversationOf} = ${conversationId}`,
  ) as SQL
}

/** Sayfanın ham satırları: veri ve sıra; biçim denetimi çağıranındır. */
export interface MessageRows {
  /** Eskiden yeniye. */
  rows: unknown[]
  /** Daha eski mesaj var mı (sonraki sayfa). */
  more: boolean
}

/**
 * Yazışmanın mesaj sayfası, en yeniden geriye (core `messagePage` sözleşmesi): `cursor` önceki
 * sayfanın en eski mesajının kimliğidir ve sayfa ondan önceki `limit` mesajdır. İmleç bu
 * yazışmanın canlı mesajı değilse `null` (rota 400). Sayfa içinde sıra eskiden yeniye.
 */
export async function conversationMessagePage(
  db: Database,
  institutionId: string,
  conversationId: string,
  { cursor, limit }: { cursor?: string | undefined; limit: number },
): Promise<MessageRows | null> {
  const where: SQL[] = [messagesOf(institutionId, conversationId)]
  if (cursor !== undefined) {
    const [anchor] = await db
      .select({ position: records.position, id: records.id })
      .from(records)
      .where(and(messagesOf(institutionId, conversationId), eq(records.id, cursor)))
      .limit(1)
    if (!anchor) return null
    where.push(sql`(${records.position}, ${records.id}) < (${anchor.position}, ${anchor.id})`)
  }
  const rows = await db
    .select({ data: records.data })
    .from(records)
    .where(and(...where))
    .orderBy(desc(records.position), desc(records.id))
    .limit(limit + 1)
  const more = rows.length > limit
  return {
    rows: rows
      .slice(0, limit)
      .reverse()
      .map((row) => row.data),
    more,
  }
}

/**
 * Yazışma başına mesaj özeti (core `MessageDigest`'in ham hali): mesaj sayısı, bakan tarafın
 * okunmamışları, son mesaj ve öğretmenin son mesajından sonraki ilk mesajın anı. Yalnız verilen
 * yazışmalar için, her biri indeks üzerinde ayrı (`lateral`) hesaplanır; mesajlar uygulamaya
 * taşınmaz, yalnız son mesaj gelir. `side` `null` ise (taraf olmayan) okunmamış 0'dır.
 */
export interface MessageDigestRow {
  conversationId: string
  messageCount: number
  unreadCount: number
  lastMessage: unknown
  firstUnansweredAt: string | null
}

export async function conversationMessageDigests(
  db: Database,
  institutionId: string,
  conversationIds: readonly string[],
  side: string | null,
): Promise<Map<string, MessageDigestRow>> {
  const result = new Map<string, MessageDigestRow>()
  if (conversationIds.length === 0) return result
  const own = (alias: string) =>
    sql.raw(
      `${alias}."institution_id" = c_inst and ${alias}."collection" = '${MESSAGES}' and ${alias}."archived_at" is null and (${alias}."data" ->> 'conversationId') = c."id"`,
    )
  // `readAt` boş sayılan JSON değerleri core `!message.readAt` ile aynıdır.
  const unread =
    side === null
      ? sql`0`
      : sql`count(*) filter (where m."data" ->> 'sender' <> ${side} and coalesce(m."data" -> 'readAt', 'null'::jsonb) in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb))`
  const query = sql`
    select c."id" as "conversationId",
           agg."message_count" as "messageCount",
           agg."unread_count" as "unreadCount",
           last."data" as "lastMessage",
           first_unanswered."date" as "firstUnansweredAt"
      from (
        select x::text as "id", ${institutionId}::text as c_inst
          from unnest(array[${sql.join(
            conversationIds.map((id) => sql`${id}`),
            sql`, `,
          )}]::text[]) as x
      ) as c
     cross join lateral (
       select count(*)::int as "message_count", (${unread})::int as "unread_count"
         from ${records} as m
        where ${own('m')}
     ) as agg
      left join lateral (
       select l."data" from ${records} as l
        where ${own('l')}
        order by l."position" desc, l."id" desc
        limit 1
     ) as last on true
      left join lateral (
       select t."position", t."id" from ${records} as t
        where ${own('t')} and t."data" ->> 'sender' = 'teacher'
        order by t."position" desc, t."id" desc
        limit 1
     ) as last_teacher on true
      left join lateral (
       select f."data" ->> 'date' as "date" from ${records} as f
        where ${own('f')}
          and (last_teacher."id" is null or (f."position", f."id") > (last_teacher."position", last_teacher."id"))
        order by f."position" asc, f."id" asc
        limit 1
     ) as first_unanswered on true`
  const rows = await db.execute<Record<string, unknown>>(query)
  for (const row of rowsOf(rows)) {
    const conversationId = String(row.conversationId)
    result.set(conversationId, {
      conversationId,
      messageCount: Number(row.messageCount),
      unreadCount: Number(row.unreadCount),
      lastMessage: row.lastMessage ?? null,
      firstUnansweredAt: typeof row.firstUnansweredAt === 'string' ? row.firstUnansweredAt : null,
    })
  }
  return result
}

/** `execute` sonucu: node-postgres ve PGlite `{ rows }` döndürür. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  const rows = (result as { rows?: unknown }).rows
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}
