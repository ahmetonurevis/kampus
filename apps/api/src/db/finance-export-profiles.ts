import { and, eq, isNull, sql } from 'drizzle-orm'

import type { FinanceExportProfile } from '@kampus/school-core/lib/finance-export-profile.ts'

import type { Database } from './client.ts'
import { financeExportProfiles } from './schema/finance-export-profiles.ts'

export type StoredFinanceExportProfile = { profile: FinanceExportProfile | null; version: number }

/** Kurumun profili; satır yoksa standart dosya ve sürüm 1. */
export async function loadFinanceExportProfile(
  db: Database,
  institutionId: string,
): Promise<StoredFinanceExportProfile> {
  const [row] = await db
    .select({
      profile: financeExportProfiles.profile,
      version: financeExportProfiles.version,
    })
    .from(financeExportProfiles)
    .where(
      and(
        eq(financeExportProfiles.institutionId, institutionId),
        isNull(financeExportProfiles.archivedAt),
      ),
    )
    .limit(1)
  return row ?? { profile: null, version: 1 }
}

/** Sürüm koşuluyla yazar; ilk yazımda satır açılır. Sürüm tutmazsa `null` (409). */
export async function saveFinanceExportProfile(
  tx: Database,
  institutionId: string,
  input: { profile: FinanceExportProfile | null; expectedVersion: number; now: Date },
): Promise<StoredFinanceExportProfile | null> {
  const columns = {
    profile: financeExportProfiles.profile,
    version: financeExportProfiles.version,
  }
  const [updated] = await tx
    .update(financeExportProfiles)
    .set({
      profile: input.profile,
      version: sql`${financeExportProfiles.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(financeExportProfiles.institutionId, institutionId),
        eq(financeExportProfiles.version, input.expectedVersion),
      ),
    )
    .returning(columns)
  if (updated) return updated
  if (input.expectedVersion !== 1) return null
  const [created] = await tx
    .insert(financeExportProfiles)
    .values({
      institutionId,
      profile: input.profile,
      version: 2,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning(columns)
  return created ?? null
}
