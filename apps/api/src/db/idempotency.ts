import { and, eq, gt, lte, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { Database } from './client.ts'
import { IDEMPOTENCY_TTL_MS, idempotencyKeys } from './schema/idempotency-keys.ts'

/**
 * `idempotency_keys` deposu (api-tasarimi.md §7). Anahtar kurum + kullanıcı kapsamındadır; ilk
 * parametre her zaman `institutionId`'dir. Bütün fonksiyonlar işlemin transaction'ı içinde
 * çağrılır: kayıt işlemle birlikte yazılır veya birlikte geri alınır.
 */

export interface StoredResponse {
  requestHash: string
  statusCode: number
  body: unknown
}

/**
 * Anahtarın danışma kilidi ad alanı ("KMPI"); kurum kilidinden (`lockInstitution`) ayrıdır.
 * Kilit `try` ile alınır: aynı anahtarla süren başka istek varsa beklemeden `false` döner ve
 * çağıran 409 `idempotency_in_progress` verir. Kilit transaction sonunda bırakılır.
 */
const IDEMPOTENCY_LOCK_NAMESPACE = 0x4b4d5049

/** Sürücüden bağımsız sonuç biçimi: node-postgres ve PGlite ikisi de `rows` döndürür. */
const lockResultSchema = z.object({ rows: z.array(z.object({ locked: z.boolean() })) })

export async function tryLockIdempotencyKey(
  tx: Database,
  institutionId: string,
  userId: string,
  key: string,
): Promise<boolean> {
  // Ayraç (US, 0x1F) kimliklerde geçmez; NUL'dan farklı olarak PostgreSQL metninde geçerlidir.
  const identity = `${institutionId}\u001f${userId}\u001f${key}`
  const result = lockResultSchema.parse(
    await tx.execute(
      sql`select pg_try_advisory_xact_lock(${IDEMPOTENCY_LOCK_NAMESPACE}::int, hashtext(${identity})) as locked`,
    ),
  )
  return result.rows[0]?.locked === true
}

/** Süresi dolmamış kayıt; süresi dolan kayıt yokmuş gibi davranır. */
export async function findIdempotentResponse(
  tx: Database,
  institutionId: string,
  userId: string,
  key: string,
  now: Date,
): Promise<StoredResponse | null> {
  const [row] = await tx
    .select({
      requestHash: idempotencyKeys.requestHash,
      statusCode: idempotencyKeys.responseStatus,
      body: idempotencyKeys.responseBody,
    })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.institutionId, institutionId),
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.key, key),
        gt(idempotencyKeys.expiresAt, now),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Başarılı yanıtı saklar. Önce kurumun süresi dolmuş bütün anahtarları silinir (aynı anahtarın
 * eski kaydı dahil): 24 saat saklama sınırı (guvenlik-kvkk.md §10) iş kuyruğu kurulana kadar
 * yazma sırasında fırsatçı olarak uygulanır; süresi dolmamış kayıt varsa çağıran onu zaten
 * yanıtlamıştır. Açılışta ayrıca bütün kurumlar temizlenir (`server.ts`).
 */
export async function saveIdempotentResponse(
  tx: Database,
  institutionId: string,
  userId: string,
  key: string,
  response: StoredResponse,
  now: Date,
): Promise<void> {
  await tx
    .delete(idempotencyKeys)
    .where(
      and(eq(idempotencyKeys.institutionId, institutionId), lte(idempotencyKeys.expiresAt, now)),
    )
  await tx.insert(idempotencyKeys).values({
    institutionId,
    userId,
    key,
    requestHash: response.requestHash,
    responseStatus: response.statusCode,
    responseBody: response.body,
    createdAt: now,
    expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
  })
}

/**
 * Süresi dolan anahtarları kalıcı siler (guvenlik-kvkk.md §10: 24 saat). Kurumlar arası teknik
 * temizliktir; silinen satır sayısını döndürür.
 * Bugün açılışta (`server.ts`) ve kurum başına yazma sırasında (`saveIdempotentResponse`) çalışır.
 * TODO(jobs): pg-boss günlük temizlik işi kurulunca oradan da çağrılır.
 */
export async function purgeExpiredIdempotencyKeys(db: Database, now: Date): Promise<number> {
  const deleted = await db
    .delete(idempotencyKeys)
    .where(lte(idempotencyKeys.expiresAt, now))
    .returning({ key: idempotencyKeys.key })
  return deleted.length
}
