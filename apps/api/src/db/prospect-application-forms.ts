import { and, count, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'

import type { Database } from './client.ts'
import { auditLog } from './schema/audit-log.ts'
import { prospectApplicationForms } from './schema/prospect-application-forms.ts'

/**
 * Ön başvuru formu deposu (ON-133). Yönetici uçları kurum kapsamlıdır (ilk parametre
 * `institutionId`); `findApplicationFormByKey` açık uçta kurumu anahtardan çözer (tablodaki
 * belgelenmiş istisna). Sürüm denetimi `where version = $beklenen` ile yazmanın içindedir.
 */

export type ApplicationFormRow = typeof prospectApplicationForms.$inferSelect

/** Formdan aday açılmasının denetim eylemi; kurum tavanı bunu sayar. */
export const APPLICATION_PROSPECT_ACTION = 'prospect.application'
/** Mevcut adaya form notu düşmesinin denetim eylemi; tavana girmez. */
export const APPLICATION_NOTE_ACTION = 'prospect.application.note'

/**
 * Tavan doluyken alınamayan başvurunun denetim eylemi (K-23): yalnız sayılır, satır kurum dışında
 * bilgi taşımaz. Kurum tavanına girmez.
 */
export const APPLICATION_REJECTED_ACTION = 'prospect.application.rejected'

/**
 * `[from, to)` aralığında formdan açılan aday ve alınamayan başvuru sayısı. `audit_log` yalnız
 * eklenir: arşivlenen aday tavanı boşaltmaz; sistem aktörü `audit_log_actor_idx` ile yalnız aralığın
 * satırlarını okur, kurumun bütün adaylarını taramaz.
 */
export async function countApplicationEvents(
  db: Database,
  institutionId: string,
  from: Date,
  to: Date,
): Promise<{ opened: number; rejected: number }> {
  const rows = await db
    .select({ action: auditLog.action, total: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.institutionId, institutionId),
        isNull(auditLog.actorUserId),
        gte(auditLog.createdAt, from),
        lt(auditLog.createdAt, to),
        inArray(auditLog.action, [APPLICATION_PROSPECT_ACTION, APPLICATION_REJECTED_ACTION]),
      ),
    )
    .groupBy(auditLog.action)
  const totalOf = (action: string) => rows.find((row) => row.action === action)?.total ?? 0
  return {
    opened: totalOf(APPLICATION_PROSPECT_ACTION),
    rejected: totalOf(APPLICATION_REJECTED_ACTION),
  }
}

export async function findApplicationForm(
  db: Database,
  institutionId: string,
): Promise<ApplicationFormRow | null> {
  const [row] = await db
    .select()
    .from(prospectApplicationForms)
    .where(
      and(
        eq(prospectApplicationForms.institutionId, institutionId),
        isNull(prospectApplicationForms.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function findApplicationFormByKey(
  db: Database,
  formKey: string,
): Promise<ApplicationFormRow | null> {
  const [row] = await db
    .select()
    .from(prospectApplicationForms)
    .where(
      and(
        eq(prospectApplicationForms.formKey, formKey),
        isNull(prospectApplicationForms.archivedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

/** İlk satır (form kapalı); eşzamanlı ikinci istek satır döndürmez, çağıran 409 verir. */
export async function insertApplicationForm(
  db: Database,
  institutionId: string,
  formKey: string,
  now: Date,
): Promise<ApplicationFormRow | null> {
  const [row] = await db
    .insert(prospectApplicationForms)
    .values({ institutionId, formKey, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning()
  return row ?? null
}

/** Beklenen sürümdeki satırı yazar; sürüm tutmazsa `null`. */
export async function updateApplicationFormRow(
  db: Database,
  institutionId: string,
  expectedVersion: number,
  values: Partial<Pick<ApplicationFormRow, 'enabled' | 'siteOrigin' | 'formKey'>>,
  now: Date,
): Promise<ApplicationFormRow | null> {
  const [row] = await db
    .update(prospectApplicationForms)
    .set({ ...values, updatedAt: now, version: sql`${prospectApplicationForms.version} + 1` })
    .where(
      and(
        eq(prospectApplicationForms.institutionId, institutionId),
        eq(prospectApplicationForms.version, expectedVersion),
        isNull(prospectApplicationForms.archivedAt),
      ),
    )
    .returning()
  return row ?? null
}
