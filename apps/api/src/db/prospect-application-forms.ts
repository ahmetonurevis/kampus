import { and, eq, isNull, sql } from 'drizzle-orm'

import type { Database } from './client.ts'
import { prospectApplicationForms } from './schema/prospect-application-forms.ts'

/**
 * Ön başvuru formu deposu (ON-133). Yönetici uçları kurum kapsamlıdır (ilk parametre
 * `institutionId`); `findApplicationFormByKey` açık uçta kurumu anahtardan çözer (tablodaki
 * belgelenmiş istisna). Sürüm denetimi `where version = $beklenen` ile yazmanın içindedir.
 */

export type ApplicationFormRow = typeof prospectApplicationForms.$inferSelect

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
